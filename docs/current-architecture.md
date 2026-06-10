# Pförtner Current Architecture

作成日: 2026-06-09

この文書は、責務境界リファクタリング後の実装構造を読むための現行メモである。過去の判断や移行理由は `docs/*-goal-plan.md` に残し、このファイルでは現在の module boundary だけを扱う。

## Public API

`mod.ts` は意図した公開面だけを export する。

- core API: `pfortnerInit`, `ConnectionInfo`, `OutputMessage`, `Policy`
- config/request handling: config loader, `buildRequestHandler`, `RequestHandler`
- plugin system: plugin registry, plugin types, `extractEvent`
- infra: Redis, Deno KV, GeoIP, Prometheus, log buffer, relay info
- admin/operation: `createAdminHandler`, `AdminState`, `AdminConnectionDto`, `AdminServiceState`, `ConnectionManager`, `ShutdownManager`, `UpstreamProbe`, `ManagedConnection`
- policies/conditions/routing: builtin policy plugins, condition helpers, `UpstreamPool`

内部 helper は `mod.ts` から直接 export しない。特に `src/session/*`、`admin/*_routes.ts`、`src/config/pipeline-resolver.ts`、`src/config/runtime-guards.ts` は内部構造として扱う。

## Core Session

`src/pfortner.ts` は `pfortnerInit()` の公開 shape と session composition を担当する。

- `src/session/auth.ts`: NIP-42 AUTH 検証、relay/challenge/time/replay/attempt/blocklist 判定
- `src/session/events.ts`: lifecycle event listener registry、`on`/`off`/`clear`/`emit`
- `src/session/pipeline-runner.ts`: policy tuple 正規化、`accept`/`reject`/`next` 実行
- `src/session/client-session.ts`: client payload の JSON array parse と NOTICE error 変換
- `src/session/upstream.ts`: upstream header と socket close helper

`src/pfortner.ts` の integration tests は public behavior の regression として残し、抽出 module は単体 test で境界を固定する。

## Config Bootstrap

`src/config/starter.ts` は request handler composition root である。

- `src/config/pipeline-resolver.ts`: plugin direction/schema validation、recursive `pipelineResolver`
- `src/config/runtime-guards.ts`: client IP selection、draining、connection pressure、runtime IP blocklist
- `src/config/managed-connection-adapter.ts`: `pfortnerInit()` result から `ManagedConnection` を作り、disconnect cleanup を接続する
- `src/config/request-handler-types.ts`: request handler と hook types

`buildRequestHandler()` は config、infra、registry、hooks を組み合わせ、guard 通過後に per-connection `pfortnerInit()` instance を作る。

## Admin Server

`admin/main.ts` は Fresh app の assembly、login/logout glue、middleware 接続に集中する。

- `admin/security.ts`: cookie credential、login redirect/cookie、same-origin/CSRF 判定
- `admin/static_files.ts`: static path resolution、content type、cache-control、file cache
- `admin/page_routes.ts`: authenticated Fresh page route registration
- `admin/api_routes.ts`: Admin JSON/SSE/mutation API route registration
- `admin/route_types.ts`: route registrar が必要とする最小 app interface

`admin/main.ts` に新しい Admin API の business logic を追加しない。API の計算や read model は `src/admin/*` に置き、`admin/api_routes.ts` は HTTP 変換に留める。

## Admin Services

`src/admin/service.ts` は互換用 barrel であり、実装は以下に分かれる。

- `src/admin/state.ts`: `AdminServiceState`
- `src/admin/config_view.ts`: secret masking
- `src/admin/health.ts`: simple/detail health response
- `src/admin/connections.ts`: Admin connection DTO と close 操作
- `src/admin/logs.ts`: log limit、buffer read、SSE stream response
- `src/admin/throughput.ts`: throughput read model
- `src/admin/pipeline_simulator.ts`: Playground pipeline simulation

新規 code は、互換が必要な場合を除いて `src/admin/service.ts` ではなく実体 module を import する。

## Admin UI

Authenticated `/admin/*` page route は Fresh-rendered page を返す。`/admin/login` も Fresh `ctx.render()` を通る SSR page として扱う。

- `admin/components/Sidebar.tsx`: shared sidebar と `Layout`。`body` に `f-client-nav` を付け、sidebar を Fresh `Partial` の `admin-sidebar`、`main` 内を `admin-content` として差し替え対象にする。
- `admin/page_routes.ts`: `/admin/`, `/admin/connections`, `/admin/pipelines`, `/admin/metrics`, `/admin/blocklist`, `/admin/config`, `/admin/logs` を page renderer map に登録する。
- `admin/routes/*.tsx`: page DOM の source of truth。
- `admin/static/dom.js`: shared DOM helper。
- `admin/static/fresh_nav.js`: programmatic Fresh App で空の client entry が出ることを避ける admin-local partial navigation runtime。Fresh の partial marker を使い、admin island static chunk mount を navigation 後に呼び直す。layout-level behavior として theme toggle を mount し、Dashboard page の polling/rendering、Connections page の fetch/filter/disconnect behavior、Metrics page の chart/raw viewer behavior、Logs page の info/fallback/SSE behavior、Config page の read/reload behavior、Blocklist page の add/delete/list behavior も client entry 側で初期化する。標準 Fresh build へ移すまでは、この file が `f-client-nav` / `Partial` と hand-written island chunk loading の互換 bridge である。
- `admin/fresh_islands.ts`: `@fresh/core/internal` `ProdBuildCache` を使い、programmatic `/admin` app の client entry と island chunk URL を Fresh SSR に登録する。これは chunk URL の manifest であり、browser bundle は生成しない。
- `admin/islands/PipelineWorkbench.tsx`: Pipeline Workbench の Fresh island composition root。SSR initial graph props、direction state、toolbar/palette/canvas/modal composition、save/load/publish/playground action dispatch を担う。
- `admin/islands/PipelineWorkbench.browser.tsx`: `PipelineWorkbench.tsx` を browser で mount するための adapter source。`scripts/build_admin_islands.ts` / `deno task build:admin-islands` で `/admin/static/islands/PipelineWorkbench.js` へ bundle し、Fresh boot props を decode して SSR placeholder を Preact mount point に差し替える。
- `admin/islands/pipeline/*`: graph canvas、toolbar、palette、modals、API client、reducer、viewport/minimap/canvas interaction hook、keyboard hook。
- `admin/islands/pipeline/{graph.js,workbench_state.js,config_editor.js}`: Pipeline Workbench の pure helper 実体。Fresh island/reducer code は `admin/static` の helper 実装を import しない。
- `admin/static/islands/PipelineWorkbench.js`: `deno task build:admin-islands` の生成 output。programmatic Fresh app が URL-addressed island chunk を必要とする間だけ残す compatibility artifact で、source of truth は `admin/islands/PipelineWorkbench.browser.tsx` と `admin/islands/pipeline/*` である。

古い custom SPA shell (`AdminAppShell`, `admin/static/app.js`, `admin/static/router.js`, `admin/static/page_templates.js`) は active architecture から削除済みである。複雑な interactive UI は段階的に Fresh islands へ移す。

## Docs

`docs/*-goal-plan.md` は履歴と意思決定を残すための計画ファイルである。現在構造を確認するときはこの `docs/current-architecture.md` と `CLAUDE.md` を優先する。
