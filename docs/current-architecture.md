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
- `admin/static/fresh_nav.js`: programmatic Fresh App で空の client entry が出ることを避ける admin-local partial navigation runtime。Fresh の partial marker を使い、page-local module の `init*Page()` と admin island static chunk mount を navigation 後に呼び直す。layout-level behavior として theme toggle もここで mount する。
- `admin/islands/PipelineWorkbench.tsx`: Pipeline Workbench の Fresh island composition root。
- `admin/islands/pipeline/*`: graph canvas、toolbar、palette、modals、API client、reducer。
- `admin/islands/pipeline/{graph.js,workbench_state.js,config_editor.js}`: Pipeline Workbench の pure helper 実体。Fresh island/reducer code は `admin/static` の helper 実装を import しない。
- `admin/static/islands/PipelineWorkbench.js`: 現行 admin island bridge 用の static chunk。Fresh hydration を完全導入するまで、ブラウザ側 workbench interaction をここで mount する。
- `admin/static/pipeline_{graph,workbench_state,config_editor}.js`: static Workbench bridge 用の一時互換 helper copy。`admin/static/islands/PipelineWorkbench.js` を削除または縮小した後に削除・縮小する。
- `admin/static/{dashboard,connections,metrics,blocklist,config,logs}.js`: SSR page markup に対する page-local behavior module。

古い custom SPA shell (`AdminAppShell`, `admin/static/app.js`, `admin/static/router.js`, `admin/static/page_templates.js`) は active architecture から削除済みである。page-local behavior module は互換層として残し、複雑な interactive UI は段階的に Fresh islands へ移す。

## Docs

`docs/*-goal-plan.md` は履歴と意思決定を残すための計画ファイルである。現在構造を確認するときはこの `docs/current-architecture.md` と `CLAUDE.md` を優先する。
