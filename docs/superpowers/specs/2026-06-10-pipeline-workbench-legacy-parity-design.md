# Pipeline Workbench Legacy Parity 設計

## 目的

`/admin/pipelines` の UI を、削除前の `admin/static/pipelines.js` が提供していた操作感と機能に戻す。
戻し方は legacy script の再追加ではなく、現在の Fresh / Partial / island bootstrap 構成を維持したうえで、
旧 controller の可視挙動を `PipelineWorkbench` island static chunk と Preact SSR shell に移植する。

この設計での「完全再現」は、旧 UI のユーザー可視機能、保存される DAG draft の shape、
runtime config への publish 結果、keyboard / pointer / modal の主要操作が同等に動くことを指す。
内部実装名やファイル分割は現在のスタックに合わせてよいが、ユーザーが触る UI と保存データは旧 UI を基準にする。

## 基準仕様

基準は commit `9a446a2^` の `admin/static/pipelines.js` である。
このファイルに存在した以下の機能を parity scope とする。

- Client / Server direction ごとの graph、selection、execution highlight、viewport state。
- active config、server draft、local draft の load selection。
- DAG draft の localStorage / server save と `viewports` 保存。
- runtime config publish と YAML preview / confirmation。
- policy palette の click add、drag start、canvas drop add。
- palette collapsed rail と collapsed state persistence。
- start node を含む全 node の drag move。
- canvas pan、wheel zoom、zoom in/out、fit canvas、zoom label。
- minimap rendering。
- output port から input port への wiring と edge replace。
- edge click removal。
- selection、multi-select、marquee selection。
- Delete / Backspace、Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl/Cmd+Y、Escape、Ctrl/Cmd+Enter。
- start node は input port なし、output port と Run action あり。
- policy node は input port、policy-specific output ports、settings action あり。
- `when` node の `then` / `else` output ports。
- `match` node の `case:n` / `default` output ports。
- `match` case add/remove 時の edge reconciliation。
- settings modal の Interactive / JSON mode。
- generic config row editor、boolean / number / string / array / object / null handling。
- playground fullscreen modal、presets、connection context、run result step list。
- `matchExecutionSteps()` による executed node highlight。
- Fresh partial navigation 後の重複 mount 回避。

## 現状の問題

現在の island rewrite は `admin/static/pipelines.js` を削除し、代わりに
`admin/static/islands/PipelineWorkbench.js` と Preact component 群を持つ。
ただし parity は未達である。

- `Canvas.tsx` は固定 SVG に近く、viewport transform、minimap、marquee、wire preview を SSR shell として持たない。
- static chunk は node add / drag / simple wire / Save / Load / Publish / playground の一部だけを実装している。
- branch-aware output ports が `next` のみになっている。
- settings modal の Interactive mode が実質 JSON textarea だけになっている。
- playground result は JSON dump に寄っており、旧 UI の step list と executed node highlight がない。
- toolbar の Fit / Zoom controls が Preact shell から落ちている。
- viewport は draft shape には残るが、UI 操作としての pan / zoom / fit が復元されていない。
- Preact island state と static bridge の責務が重複し、差分が出やすい。

## 方針

短期の復元では、削除前 controller の tested behavior を現在の island static chunk へ移植する。
`admin/static/pipelines.js` は戻さない。Fresh の build cache、`f-client-nav`、Partial navigation、
`/admin/static/islands/PipelineWorkbench.js` chunk は維持する。

Preact 側は first paint / no-JS shell として、旧 controller が期待する DOM anchor を出す責務に寄せる。
browser interaction の authoritative 実装は当面 static chunk に置く。
この境界により、旧 UI parity を先に回復し、以降の整理phaseで static chunk の中身を小さな pure helpers /
typed modules に分割できる。

## UI 要件

### Shell

- `/admin/pipelines` は `Layout` 内に `PipelineWorkbench` island を mount する。
- toolbar は Client / Server、Undo / Redo、Run、Load、Save、Publish、Fit、Zoom out、Zoom in を出す。
- status summary、Save badge、Publish badge を出す。
- main area は collapsed 可能な palette と canvas の 2 column を基本にする。
- mobile では palette rail と横スクロール可能な canvas を維持し、node / toolbar text が重ならない。

### Canvas

- `#pipeline-canvas`、`#pipeline-svg`、`#selection-marquee`、`#minimap-svg` を SSR shell に含める。
- static chunk は load 後に SVG を全面再描画してよい。
- graph viewport は `translate(pan.x, pan.y) scale(zoom)` で適用する。
- start node も drag できる。
- start node の input port は描画しない。
- `when` と `match` の branch ports は node height に合わせて縦配置する。
- edge は visible path と transparent hit path を持つ。
- edge hit click で edge を削除する。

### Palette

- expanded では icon / policy name / plus を表示する。
- collapsed では icon rail として表示し、click add は維持する。
- palette item は drag source として canvas drop add に使える。
- collapsed state は localStorage に保存する。

### Settings Modal

- policy node double click または node action で開く。
- `Interactive` と `JSON` の mode を持つ。
- Interactive mode は key / type / value row editor を表示する。
- boolean は checkbox、number は number input、string は text input、array / object は JSON textarea、null は type row で扱う。
- `match` node では case add / remove control を表示し、Apply 時に branch edges を reconcile する。
- JSON mode は parse error を modal 内に表示し、Apply を止める。

### Playground Modal

- start node action、start node double click、toolbar Run で fullscreen modal を開く。
- preset buttons、message textarea、authenticated checkbox、pubkey、client IP を表示する。
- Run は current direction の serialized pipeline を `/admin/api/playground/evaluate` に送る。
- result steps を action / policy / branch / reason 付きの list として表示する。
- result と `matchExecutionSteps()` から canvas node を executed highlight する。

## Data 要件

- `admin/static/pipeline_graph.js` の `pipelinesToGraph()` / `graphToPipelines()` / `validatePipelineGraph()` /
  `matchExecutionSteps()` を継続利用する。
- `admin/static/pipeline_config_editor.js` の config editor helper を Preact / static chunk の共通仕様にする。
- `admin/static/pipeline_workbench_state.js` の draft version、localStorage keys、history helpers を継続利用する。
- draft は `{ version, graphs, viewports, updatedAt, lastPublishedFingerprint }` の shape を維持する。
- Save は invalid graph でも許可する。
- Publish は client / server の両 graph を validate し、invalid なら送信しない。
- Load は server draft、local draft、active config fallback の順序と status message を旧 UI と同等にする。

## 実装境界

### Authoritative browser behavior

- `admin/static/islands/PipelineWorkbench.js`

### SSR shell / typed composition

- `admin/islands/PipelineWorkbench.tsx`
- `admin/islands/pipeline/Toolbar.tsx`
- `admin/islands/pipeline/Palette.tsx`
- `admin/islands/pipeline/Canvas.tsx`
- modal componentsはSSR fallbackとして残してよいが、parity復元中のruntime modal生成はstatic chunkを優先する。

### Pure helpers

- `admin/static/pipeline_graph.js`
- `admin/static/pipeline_config_editor.js`
- `admin/static/pipeline_workbench_state.js`
- `admin/islands/pipeline/node_defaults.ts`
- `admin/islands/pipeline/yaml_preview.ts`

## テスト要件

Unit / DOM fake tests:

- static chunk が mount 可能で、Partial navigation 後も重複 binding しない。
- toolbar の Fit / Zoom / Run が存在する。
- initial load 後に start node が描画される。
- click add と canvas drop add が active graph に反映される。
- node drag で position と edge path が更新される。
- canvas pan / wheel zoom / fit が viewport と draft に反映される。
- start node input port が存在しない。
- `when` / `match` ports が描画され、branch edge が serialized pipeline に戻る。
- edge hit click で edge removal が undoable に反映される。
- marquee selection と Delete が policy node を削除する。
- settings Interactive row editor が config を更新する。
- `match` case remove が branch edges を prune / renumber する。
- playground run が step list を描画し、executed class を node に付与する。
- Save / Load / Publish が current rendered graph と viewport を使う。

Browser QA:

- desktop: palette add、drag、wire、settings apply、playground run、save、publish modal、fit、zoom、pan。
- mobile: palette collapsed rail、canvas visible area、modal fit、toolbar wrap、no overlap。
- console error がない。

## 非目標

- React Flow などの新規 canvas library 導入。
- 新 API の追加。
- `admin/static/pipelines.js` の復活。
- 全 admin UI の redesign。
- pipeline runtime semantics の変更。

## Completion Definition

- parity checklist の各項目に test または browser QA evidence がある。
- `admin/static/pipelines.js` は存在しない。
- `/admin/pipelines` は Fresh island marker と `/admin/static/islands/PipelineWorkbench.js` chunk を使う。
- Deno fmt / lint / check / relevant tests / `src/` tests が通る。
- desktop / mobile Playwright QA で主要操作が通る。
