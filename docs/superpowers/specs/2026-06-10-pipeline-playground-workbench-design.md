# Pipeline / Playground 統合ワークベンチ設計

## 目的

`/admin/pipelines` を、pipeline 編集と Playground 検証を同じ画面で行える n8n 風の配線型ワークベンチに統合する。既存の runtime と config 互換性を維持し、見た目は graph editor にしつつ、保存できる構造は現行の `pipelines.client` / `pipelines.server` に戻せる範囲に制約する。

`/admin/playground` は後方互換を持たせず削除する。サイドバー、SPA routes、サーバー page routes から外し、直接アクセス時は既存 router の unknown page 扱いにする。

## 画面構成

`/admin/pipelines` は統合ワークベンチになる。

- 上部 toolbar: `Client / Server` 切替、`Refresh`、`Run`、`Apply Config`、`Fit`、zoom controls。
- 左 panel: policy palette。利用可能な plugin / policy を表示し、クリックまたは canvas への追加操作で node を作る。
- 中央: SVG ベースの配線キャンバス。grid、node、edge、port、selection、execution highlight を表示する。
- 右 panel: inspector。選択 node の policy 名、config JSON、validation status を編集・確認する。
- 右下: minimap。node 概略と現在 viewport を表示し、クリックまたは drag で viewport を移動する。
- 下部 drawer: Playground。message preset、message JSON、connection context、Run、execution result をまとめる。

初回 SSR と SPA 遷移で同じ構造を表示するため、`admin/routes/pipelines.tsx` と `admin/static/page_templates.js` の `renderPipelinesPage` を同等の DOM 構造に揃える。

## Graph と config の変換

source of truth は現行 config 互換の pipeline graph とする。読み込み時に `pipelines.client` / `pipelines.server` を graph に投影し、保存・YAML preview 時に graph を pipeline entry に戻す。

通常 policy は `Start -> policy -> policy` の直列接続として扱う。`when` は `then` / `else` の出力 port を持つ branch node として扱い、`match` は `case:N` / `default` の出力 port を持つ branch node として扱う。branch の接続先は nested pipeline として現行 config に戻す。

保存可能な graph の条件:

- direction ごとに単一の start node を持つ。
- start から到達可能な node だけを pipeline として保存する。
- 直列 chain は順序化できる。
- `when` / `match` の branch は現行 config の nested pipeline に変換できる。
- 循環、複数 start、保存対象の未接続 node、現行 config に戻せない合流は invalid とする。

invalid graph の場合、`Apply Config` と YAML 反映を止め、canvas 上の該当 node / edge と status に理由を表示する。

node 位置、zoom、pan、選択状態、drawer 開閉は runtime config には保存しない。必要になった場合のみ、後続作業で localStorage 保存を追加する。

## Editor 操作

初回スコープで以下を実装する。

- pan。
- wheel zoom。
- `Fit`。
- node drag。
- edge drag。
- selection marquee。
- 複数選択。
- Delete / Backspace による削除。
- Escape による選択解除。
- minimap 表示と viewport 移動。
- palette から policy node 追加。
- inspector で config JSON 編集。
- `when` / `match` の専用 branch port 表示。

接続操作は自由に見えるが、保存できる形に制約する。invalid な接続が発生した場合は、その時点で警告し、valid graph に戻るまで保存系の操作をブロックする。

## Playground 統合

Playground は下部 drawer に統合する。閉じた状態では `Message`、`Context`、`Last result` の要約を表示し、開いた状態では既存 Playground の主要 UI を表示する。

`Run` は既存の `/admin/api/playground/evaluate` を使う。API 名は内部実装名として維持するが、UI では drawer 名と実行領域を `Test Run` と表示する。

実行時の direction は toolbar の `Client / Server` と同期する。実行結果の `steps` は step list に表示し、graph の実行順と policy 名を使って node / edge に対応付ける。`accept` は success、`reject` は danger、`next` は muted の visual state としてハイライトする。

同じ policy が複数ある場合は graph の実行順に沿って対応付ける。完全に照合できない場合は step list を正として表示し、canvas highlight は照合できた範囲に限定する。

## 移行範囲

主な更新対象:

- `admin/components/Sidebar.tsx`: `Playground` nav を削除する。
- `admin/page_routes.ts`: `/playground` page route を削除する。
- `admin/static/page_templates.js`: `/admin/playground` route を削除し、`renderPipelinesPage` を統合 layout に変更する。
- `admin/routes/pipelines.tsx`: SSR 初期表示を統合 layout に変更する。
- `admin/routes/playground.tsx`: 削除する。
- `admin/static/pipelines.js`: graph editor、config 変換、Playground drawer、結果 highlight を実装する。
- `admin/static/playground.js`: preset / result rendering / run logic を `pipelines.js` に移したうえで削除する。
- `admin/static/styles.css`: workbench、canvas、drawer、minimap、execution highlight の style を追加する。
- `src/admin/pipelines-static.test.ts`: graph 変換と validation のテストを追加する。
- `admin/static/page_templates.test.ts`: `/admin/playground` 削除を反映する。
- `admin/page_routes.test.ts`: `/playground` 削除を反映する。
- `admin/api_routes.test.ts`: evaluate endpoint が残ることを確認する。

## 非スコープ

- 任意 DAG を runtime model として保存すること。
- graph model 用の新 API を追加すること。
- node position を server config に永続化すること。
- React Flow などの graph editor ライブラリ導入。
- `/admin/playground` の redirect 後方互換。

## エラー処理

- config JSON parse error は inspector 内と page status に表示する。
- invalid graph は node / edge の visual state と page status に表示する。
- evaluate API error は Playground drawer の result panel に表示する。
- graph と execution step の照合が部分的に失敗しても、step list は表示し続ける。

## テスト方針

単体テストでは、pipeline entry から graph への変換、graph から pipeline entry への変換、invalid graph の validation、YAML preview の更新、default config を検証する。

ルーティングテストでは、`/admin/playground` が page route と SPA route から削除され、`/admin/pipelines` が統合 page module を使うことを検証する。API テストでは `/admin/api/playground/evaluate` を維持する。

手動確認では、`/admin/pipelines` で以下を確認する。

- client/server 切替で graph が切り替わる。
- node 追加、drag、edge 接続、複数選択、削除、zoom/pan、Fit、minimap が動く。
- inspector の config 編集が graph と YAML preview に反映される。
- invalid graph で保存系操作が止まる。
- Playground drawer から Run でき、結果 step と node highlight が同期する。
- mobile 幅では panel / drawer が破綻せず、主要操作にアクセスできる。
