# Pipeline Canvas-first Workbench Refinement 設計

## 目的

`/admin/pipelines` の現行統合ワークベンチを、canvas を主役にした n8n 風の編集体験へ寄せる。右側 inspector と下部 playground drawer は占有面積が大きいため廃止し、node 上の小さな action と modal に編集機能を移す。

この設計は `docs/superpowers/specs/2026-06-10-pipeline-playground-workbench-design.md` の refinement である。既存の graph editor、`pipelines.client` / `pipelines.server` への変換、`/admin/api/playground/evaluate` は活かす。置き換えるのは主に UI 構成、draft 保存モデル、Publish の意味、Undo/Redo 履歴である。

## 画面構成

`/admin/pipelines` は canvas-first layout にする。

- 上部 toolbar: `Client / Server`、`Refresh`、`Fit`、zoom、`Undo`、`Redo`、`Save DAG`、`Publish`。
- 左 palette: expanded/collapsed を切り替えられる policy palette。collapsed 時は icon rail として残し、click / drag で node を追加できる。
- 中央 canvas: SVG graph editor。node、edge、port、selection、execution highlight、minimap を表示する。
- 常設 inspector: 廃止する。選択中 node の詳細は canvas 上の action と settings modal で開く。
- playground drawer: 廃止する。Start node の Run action から fullscreen modal として開く。
- YAML preview: 常時表示から外す。Publish modal または Publish confirmation 内で、config に書く YAML diff / preview として表示する。

palette の collapsed 状態と最後の direction は `localStorage` に保存する。これは UI convenience であり、DAG draft の正規保存とは分ける。node positions と viewport は editor 再現に必要なため DAG draft に含める。

## Node 操作

各 node は右上に小さな action を持つ。

- 通常 policy node: settings action を表示する。icon は gear を基本とし、既存の visual density に合わなければ pencil に変更してよい。
- Start node: settings action は表示しない。Run action だけを表示する。
- double click: settings action と同じく node settings modal を開く。Start node の double click は playground modal を開く。
- start input port: 引き続き表示しない。output port は残す。
- start drag: 引き続き許可する。
- delete: Start node は削除不可のままにする。

action を押したときに node drag や wire drag が誤発火しないよう、action element は pointer event を止める。

## Node Settings Modal

settings modal は選択 node の config 編集だけに責務を絞る。

- header: policy 名、node id、close。
- tabs: `Interactive` と `JSON`。
- footer: `Cancel`、`Apply`、policy node では `Delete Node`。
- `Interactive`: policy ごとの主要 config を form control で編集する。
- `JSON`: config 全体を JSON textarea で編集する。

初期実装の interactive mode は汎用 schema-driven form でよい。boolean は checkbox、number は number input、string は text input、array は JSON-compatible textarea、object は nested JSON textarea として扱う。policy 固有の高品質フォームは後続で追加する。

`when` と `match` は branch 管理も modal 内に置く。`match` の case add/remove は現行 inspector の操作を移植する。branch pipeline 自体は canvas edge が正とし、modal では condition と case metadata を編集する。

JSON mode の parse error は modal 内に表示し、`Apply` で graph に反映しない。Interactive mode と JSON mode は同じ draft config を編集し、tab 切替で内容を同期する。

## Fullscreen Playground Modal

Start node の Run action、Start node double click、toolbar の Run shortcut から fullscreen playground modal を開く。toolbar の Run は現在 direction の start node から起動する。

modal 内容:

- message preset buttons。
- message JSON editor。
- connection context: authenticated、pubkey、client IP。
- Run button。
- execution result list。
- final action。

Run は既存の `/admin/api/playground/evaluate` を使い、body には現在の draft graph を `graphToPipelines()` で変換した pipeline を送る。実行結果は既存同様に canvas node highlight へ戻す。modal を閉じても最後の execution highlight は残してよい。

## Save DAG と Publish

`Save DAG` と `Publish` は明確に分ける。

`Save DAG` は editor draft を保存する操作で、runtime config は変更しない。保存対象は以下を含む。

- version。
- client/server graph の nodes、edges、node positions、node config。
- direction ごとの viewport。
- updatedAt。
- lastPublishedFingerprint。

draft は `PipelineWorkbenchDraft` として扱う。まず browser localStorage に保存し、config mode で server-side draft path が使える場合は `POST /admin/api/pipeline-draft` でも保存する。server-side draft は config path から派生した sidecar file、例: `pfortner.yaml.workbench.json` とする。

sidecar file は Deno の write permission が必要になる。`deno task serve:config` は `--allow-write=pfortner.yaml,pfortner.yaml.workbench.json` のように、config file と draft sidecar の両方を書ける設定に更新する。任意 config path で起動する利用者には、sidecar path への write permission が必要であることを error message に出す。

`Publish` は graph を runtime config の `pipelines.client` / `pipelines.server` に変換し、既存の `POST /admin/api/pipelines` で設定ファイルへ保存し reload する操作にする。Publish 前に client/server 両方の graph validation を必ず走らせる。成功後は local/server draft の `lastPublishedFingerprint` を更新する。

UI 表示:

- unpublished changes がある場合、toolbar に `Unsaved DAG` と `Unpublished changes` を別々に出す。
- `Save DAG` は draft への保存状態を更新する。
- `Publish` は runtime config への反映状態を更新する。

## Undo / Redo

editor 操作は undo stack に積む。対象操作は node add/delete/move、edge add/remove、node config apply、match case add/remove、direction graph replace、DAG load である。

drag 中は履歴を連続追加せず、pointerup で 1 action として記録する。modal 内の一時入力は履歴に積まず、`Apply` で 1 action として記録する。

履歴は現在 page session 内だけでよい。DAG draft 保存時に undo stack は保存しない。Undo/Redo 後は YAML preview、validation、minimap、execution highlight を再計算する。新しい操作を行ったら redo stack は破棄する。

## Data Flow

load 時:

1. `/admin/api/config` から runtime pipelines を読む。
2. `/admin/api/pipeline-draft` が使える場合は server draft を読む。
3. localStorage draft も読む。
4. server draft と localStorage draft のうち、runtime config と同じ `lastPublishedFingerprint` を持つものだけを候補にする。
5. 候補が複数ある場合は `updatedAt` が新しい draft を採用する。
6. 候補がない、壊れている、または runtime config と衝突する場合は、runtime pipelines から graph を作り、ユーザーに fallback status を出す。

editing 時:

1. graph state を更新する。
2. undo state を更新する。
3. validation、minimap、status を更新する。
4. local unsaved/unpublished state を更新する。

publish 時:

1. client/server graph を validate する。
2. graph を `pipelines` に serialize する。
3. YAML preview / confirmation を表示する。
4. `/admin/api/pipelines` へ POST する。
5. response の pipelines で state を同期し、draft fingerprint を更新する。

## API

既存 API:

- `POST /admin/api/pipelines`: Publish 用として維持する。
- `POST /admin/api/playground/evaluate`: fullscreen playground 用として維持する。

追加 API:

- `GET /admin/api/pipeline-draft`: sidecar draft があれば返す。未設定または未作成なら `{ draft: null }`。
- `POST /admin/api/pipeline-draft`: normalized draft を sidecar file に保存する。

HTTP route は `admin/api_routes.ts` に置くが、draft read/write と validation helper は `src/admin/pipeline_draft.ts` のような service module に分ける。`AdminServiceState` には `pipelineDraftPath?: string` を追加する。

## Error Handling

- settings modal の JSON parse error は modal 内に表示する。
- interactive form で型変換できない値は field error として表示し、Apply を止める。
- invalid graph は Publish を止め、status と該当 node/edge state に理由を出す。
- sidecar draft write permission がない場合、server draft 保存は失敗として表示しつつ localStorage draft は保持する。
- server draft が壊れている場合は localStorage draft、次に runtime config の順で fallback する。
- Publish が失敗した場合は draft state を変更しない。

## Testing

unit/static tests:

- start node は settings action を持たず、Run action だけを持つ。
- policy node は settings action を持つ。
- double click の routing helper が start と policy で分岐する。
- settings modal の JSON parse/apply helper。
- generic interactive form の value conversion。
- undo/redo reducer。
- draft fingerprint と unsaved/unpublished state。
- draft normalize / reject invalid draft。

route/API tests:

- `GET /admin/api/pipeline-draft` が未設定時に draft null を返す。
- `POST /admin/api/pipeline-draft` が draft を保存する。
- sidecar write failure を JSON error にする。
- `POST /admin/api/pipelines` は Publish API として既存挙動を維持する。

browser/manual tests:

- palette expanded/collapsed 切替と状態復元。
- collapsed icon rail から node を追加できる。
- node gear click と double click で settings modal が開く。
- settings modal の Interactive/JSON が同期する。
- Start node の Run で fullscreen playground modal が開く。
- node move、config edit、edge edit が Undo/Redo できる。
- Save DAG 後に reload して node positions が復元される。
- Publish 後に config file と runtime reload が更新される。

## 非スコープ

- runtime pipeline model を任意 DAG に変更すること。
- policy 固有の完全な custom interactive editor を初回から作ること。
- multi-user conflict resolution。
- undo stack の永続化。
- `/admin/playground` の復活。
