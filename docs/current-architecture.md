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

内部 helper は `mod.ts` から直接 export しない。特に `src/session/*`、`admin/*_routes.ts`、`admin/static/router.js`、`src/config/pipeline-resolver.ts`、`src/config/runtime-guards.ts` は内部構造として扱う。

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
- `admin/page_routes.ts`: authenticated SPA shell page route registration
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

## Admin SPA

Authenticated `/admin/*` page route は同じ `AdminAppShell` を返し、browser が SPA として画面を描画する。`/admin/login` は SSR login page のまま扱う。

- `admin/static/app.js`: `globalThis.__PFORTNER_SPA__` 設定、asset version propagation、SPA boot
- `admin/static/router.js`: path normalize、active nav、History API、dynamic import、cleanup lifecycle
- `admin/static/page_templates.js`: route ごとの DOM template、module path、initializer name
- `admin/static/dom.js`: shared DOM helper
- `admin/static/{dashboard,connections,pipelines,playground,metrics,blocklist,config,logs}.js`: fetch/event binding/cleanup

page module は `init*Page()` を export し、SPA router 経由では自動初期化 guard により二重初期化を避ける。

## Docs

`docs/*-goal-plan.md` は履歴と意思決定を残すための計画ファイルである。現在構造を確認するときはこの `docs/current-architecture.md` と `CLAUDE.md` を優先する。
