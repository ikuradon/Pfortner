# Pipeline Workbench Island Rewrite 設計

## 目的

`/admin/pipelines` の Pipeline Workbench を、巨大な imperative DOM controller である
`admin/static/pipelines.js` から Fresh island ベースの component 群へ一括 rewrite する。

対象は canvas、palette、toolbar、node settings modal、fullscreen playground、Save、Load、Publish、
Undo、Redo を含む full workbench である。ユーザー体験としては現在の n8n 風配線 editor を維持しつつ、
状態管理と描画境界を Preact component / reducer に寄せ、Fresh partial navigation 後の
`initPipelinesPage()` 再実行依存をなくす。

ただし、既に検証済みの graph / config / draft helper は捨てない。捨てる対象は
`admin/static/pipelines.js` が抱えている browser DOM mutation、event binding、modal construction、
render orchestration である。

## 成功条件

- `/admin/pipelines` は SSR shell として返り、workbench は Fresh island として hydrate される。
- `admin/static/pipelines.js` は削除される。
- pipeline graph の変換、validation、draft fingerprint、history helper は既存 module を再利用する。
- Start node は input port を持たず、Run action だけを持つ。
- policy node は settings action と double click で node settings modal を開く。
- node settings modal は `Interactive` と `JSON` の 2 mode を持つ。
- Start node の Run action と toolbar Run は fullscreen playground modal を開く。
- Save は DAG draft を保存し、Publish は runtime config へ反映する。
- Load は保存済み DAG と runtime config fallback を明確に扱う。
- Undo / Redo は node add/delete/move、edge edit、config apply、DAG load、publish state sync を扱う。
- Fresh partial navigation で `/admin/pipelines` に戻っても workbench が重複 boot しない。
- desktop と mobile の主要操作で layout overlap がない。

## Hard Gate: Fresh Island Bootstrap

実装の最初に、Pipeline Workbench ではなく最小の admin island を使って Fresh island bootstrap を確認する。

確認すること:

- programmatic `App` でも `clientEntry` が空文字にならない。
- browser HTML に空の `import { boot } from ""` が出ない。
- `/admin/pipelines` で island marker と props が出力される。
- browser で island が hydrate され、button click のような最小 interaction が動く。
- `f-client-nav` / `Partial` navigation 後も island が再 hydrate される。

この gate が通るまでは `admin/static/pipelines.js` を削除しない。Fresh の標準 client build を成立させるため、
必要なら admin 用の client entry、islands directory、build output、static serving、task を追加する。
標準 build path がこの repo の programmatic admin sub-app と噛み合わない場合は、ここで実装を止めて設計を見直す。

## Target Architecture

`admin/routes/pipelines.tsx` は SSR shell だけを持つ。

- page header の SSR skeleton。
- `PipelineWorkbench` island の mount。
- no-JS fallback として簡単な loading / unavailable state。
- page title と authenticated layout は現行の `Layout` を使う。

新しい client-side 境界:

- `admin/islands/PipelineWorkbench.tsx`: workbench composition root。
- `admin/islands/pipeline/workbench_reducer.ts`: workbench state と action reducer。
- `admin/islands/pipeline/api_client.ts`: admin API fetch wrapper。
- `admin/islands/pipeline/Toolbar.tsx`: direction、Undo、Redo、Run、Load、Save、Publish、Fit、zoom。
- `admin/islands/pipeline/Palette.tsx`: plugin palette と collapsed rail。
- `admin/islands/pipeline/Canvas.tsx`: SVG viewport、node、edge、ports、selection、minimap。
- `admin/islands/pipeline/NodeSettingsModal.tsx`: Interactive / JSON config editor。
- `admin/islands/pipeline/PlaygroundModal.tsx`: fullscreen test run UI。
- `admin/islands/pipeline/PublishModal.tsx`: validation、YAML preview、confirmation。

既存 pure modules:

- `admin/static/pipeline_graph.js`: 維持。必要なら TypeScript 化するが、behavior は既存 test で固定する。
- `admin/static/pipeline_config_editor.js`: 維持。modal editor helper として再利用する。
- `admin/static/pipeline_workbench_state.js`: 維持。draft、fingerprint、history helper として再利用する。

削除対象:

- `admin/static/pipelines.js`。
- `fresh_nav.js` 内の `/admin/static/pipelines.js` initializer mapping。
- `admin/routes/pipelines.tsx` の `/admin/static/pipelines.js` script tag。

## State Model

`PipelineWorkbenchState` は reducer で管理する。

主な state:

- `direction`: `client` or `server`。
- `graphs`: client/server graph。
- `history`: direction ごとの undo/redo stack。
- `viewports`: direction ごとの zoom / pan。
- `selection`: selected node / edge ids。
- `execution`: last playground result と highlighted node ids。
- `plugins`: available policy names。
- `draft`: last saved draft fingerprint、server/local save status。
- `publish`: last published fingerprint、validation errors、publish status。
- `ui`: palette collapsed、active modal、settings draft、playground draft、pending operation。

drag 中の座標や wire preview などの一時 state は reducer に入れてよいが、history には pointerup / apply の単位で積む。
modal の入力中 draft は history に積まず、`Apply` で 1 action として graph に反映する。

## Data Flow

初期 load:

1. `/admin/api/config` から runtime pipelines を読む。
2. `/admin/api/plugins` から plugin names を読む。
3. `/admin/api/pipeline-draft` から server draft を読む。
4. localStorage draft を読む。
5. runtime pipelines から `publishedFingerprint` を作る。
6. server/local draft のうち `lastPublishedFingerprint` が一致するものだけを候補にする。
7. `updatedAt` が新しい draft を採用する。
8. 候補がない場合は runtime pipelines から graph を作る。
9. reducer を初期化し、canvas を render する。

editing:

1. component event が reducer action を dispatch する。
2. reducer が graph、history、selection、viewport、status を更新する。
3. derived state として validation、save badge、publish badge、minimap、YAML preview を再計算する。

Save:

1. current viewport を state に反映する。
2. `buildPipelineDraft()` で draft を作る。
3. localStorage に保存する。
4. `/admin/api/pipeline-draft` に保存を試みる。
5. server save が失敗しても local save は成功として残し、status に warning を出す。

Load:

1. 初期 load と同じ draft selection を再実行する。
2. 採用した DAG を current state に replace する。
3. replace は undo stack に 1 action として積む。
4. 採用できる draft がない場合は runtime config から graph を作り、fallback status を出す。

Publish:

1. client/server graph を validate する。
2. invalid なら Publish を止め、該当 node / edge と status に理由を出す。
3. graph を `graphToPipelines()` で runtime config 互換 shape に変換する。
4. Publish modal で YAML preview / confirmation を表示する。
5. `/admin/api/pipelines` に POST する。
6. response の pipelines で state を同期する。
7. `lastPublishedFingerprint` を更新した draft を Save と同じ経路で保存する。

Playground:

1. Start node Run、Start node double click、toolbar Run で fullscreen modal を開く。
2. 現在 direction の graph を `graphToPipelines()` で pipeline に変換する。
3. `/admin/api/playground/evaluate` に message と connection context を送る。
4. result steps を list に表示し、`matchExecutionSteps()` で node highlight に反映する。
5. modal を閉じても最後の highlight は残してよい。

## UI Behavior

layout:

- canvas-first の現行 layout を維持する。
- palette は expanded / collapsed を維持し、collapsed rail でも node 追加できる。
- node settings は常設 inspector ではなく modal で開く。
- playground は drawer ではなく fullscreen modal にする。
- Publish の YAML preview は常時表示せず、Publish modal 内に出す。

node:

- Start node は削除不可。
- Start node は input port なし、output port あり。
- Start node は移動可能。
- Start node action は Run のみ。
- policy node action は settings のみ。
- double click は Start node なら playground、policy node なら settings。

settings modal:

- `Interactive` mode は generic editor とする。
- boolean は checkbox、number は number input、string は text input。
- array / object は JSON textarea で扱う。
- `when` / `match` の branch metadata と conditions は modal で編集する。
- JSON mode parse error は modal 内に出し、Apply を止める。

keyboard:

- Delete / Backspace は selected policy nodes を削除する。
- Ctrl/Cmd+Z は Undo、Ctrl/Cmd+Shift+Z と Ctrl/Cmd+Y は Redo。
- Escape は modal が開いていれば modal close、そうでなければ selection / wire / marquee clear。
- Ctrl/Cmd+Enter は playground run。

## API

既存 API を維持する。

- `GET /admin/api/config`
- `GET /admin/api/plugins`
- `GET /admin/api/pipeline-draft`
- `POST /admin/api/pipeline-draft`
- `POST /admin/api/pipelines`
- `POST /admin/api/playground/evaluate`

初回 rewrite では新 API を増やさない。必要な差分は client 側の API wrapper と error normalization に閉じる。

## Error Handling

- bootstrap gate が失敗した場合は editor rewrite に入らず、設計見直しに戻る。
- config fetch failure は full workbench error state にする。
- plugins fetch failure は default plugin list に fallback し、warning を出す。
- server draft read failure は localStorage draft、次に runtime config へ fallback する。
- draft normalize failure はその draft を破棄し、status に warning を出す。
- Save の server-side failure は localStorage save 成功と分けて表示する。
- Publish failure は graph state と draft fingerprint を変更しない。
- invalid graph は Publish を止めるが、Save は許可する。
- Playground API failure は modal result panel に表示し、canvas highlight は更新しない。

## Testing

unit tests:

- workbench reducer の初期化、direction switch、selection、viewport update。
- node add/delete/move、edge add/remove、config apply。
- Undo / Redo。
- Save / Load の draft selection。
- Publish validation と fingerprint update。
- Start node と policy node の action routing。
- Interactive / JSON modal helper。

existing static tests:

- `pipeline_graph.js` の round trip / validation は維持する。
- `pipeline_config_editor.js` の parse / row conversion は維持する。
- `pipeline_workbench_state.js` の draft / fingerprint / history tests は維持する。
- `admin/static/pipelines.js` からだけ export されていた helper は island module へ移すか、pure module へ抽出して test を移す。

route/API tests:

- `/admin/pipelines` HTML に `PipelineWorkbench` island marker が出る。
- `/admin/pipelines` HTML に `/admin/static/pipelines.js` が出ない。
- empty Fresh boot import が出ない。
- `GET /admin/api/pipeline-draft` / `POST /admin/api/pipeline-draft` は既存挙動を維持する。
- `POST /admin/api/pipelines` は Publish API として既存挙動を維持する。

browser tests:

- Fresh partial navigation で Pipelines に移動し、island が hydrate される。
- client/server tab 切替。
- palette collapsed / expanded。
- node add、drag、edge connect、delete。
- node settings modal の Interactive / JSON edit。
- Start node Run で fullscreen playground modal が開き、run result が表示される。
- Save 後 reload で node positions と viewport が復元される。
- Load が saved DAG を復元する。
- Publish が config に反映され、badges が更新される。
- desktop と mobile viewport で toolbar / canvas / modal が overlap しない。

## Migration Strategy

一括 rewrite だが、検証可能な順序で進める。

1. Fresh island bootstrap gate を通す。
2. existing `PipelinesPage` に `PipelineWorkbench` island を mount し、旧 `pipelines.js` はまだ残す。
3. graph / draft / API helper を island 側から使える形に整理する。
4. reducer と component skeleton を作る。
5. canvas rendering と basic graph interactions を移す。
6. modal、playground、Save / Load / Publish を移す。
7. browser QA が通った時点で旧 script tag と `admin/static/pipelines.js` を削除する。
8. docs と tests を更新する。

旧 implementation と新 implementation を長期に併存させない。bootstrap と skeleton の短い期間だけ併存を許し、
最終 commit では `/admin/pipelines` の active path は island implementation だけにする。

## 非スコープ

- runtime pipeline model を任意 DAG に変更すること。
- policy 固有の完全 custom form を全 plugin に実装すること。
- multi-user conflict resolution。
- undo stack の永続化。
- `/admin/playground` の復活。
- graph editor ライブラリの導入。

## Open Risk

最大の risk は Fresh island bootstrap である。現在の admin は programmatic `App` と admin-local
`fresh_nav.js` で partial navigation を補っているため、標準 Fresh build cache / client entry を通す作業が
最初の blocker になり得る。この risk は実装の先頭 gate として扱い、workbench rewrite より前に潰す。
