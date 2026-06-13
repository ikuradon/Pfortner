# Pförtner Current Architecture

作成日: 2026-06-09
最終更新: 2026-06-13

この文書は、責務境界リファクタリング後の実装構造を読むための現行メモである。過去の判断や移行理由は `docs/*-goal-plan.md` に残し、このファイルでは現在の module boundary だけを扱う。

## Public API

`mod.ts` は意図した公開面だけを export する。

- core API: `pfortnerInit`, `ConnectionInfo`, `OutputMessage`, `Policy`
- config/request handling: config loader, `buildRequestHandler`, `RequestHandler`
- plugin system: plugin registry, plugin types, `extractEvent`
- infra: Redis, Deno KV, GeoIP, Prometheus, log buffer, relay info
- admin/operation: `createAdminHandler`, `AdminState`, `AdminConnectionDto`, `AdminServiceState`, `ConnectionManager`, `ShutdownManager`, `UpstreamProbe`, `ManagedConnection`
- policies/conditions/routing: builtin policy plugins, condition helpers, `UpstreamPool`

内部 helper は `mod.ts` から直接 export しない。特に `src/session/*`、`src/config/pipeline-resolver.ts`、`src/config/runtime-guards.ts`、Fresh UI 内部の `src/admin/ui/*`、production bootstrap 内部の `src/server/*` は内部構造として扱う。

## Core Session

`src/pfortner.ts` は `pfortnerInit()` の公開 shape と session composition を担当する。

- `src/session/auth.ts`: NIP-42 AUTH 検証、relay/challenge/time/replay/attempt/blocklist 判定
- `src/session/events.ts`: lifecycle event listener registry、`on`/`off`/`clear`/`emit`
- `src/session/pipeline-runner.ts`: policy tuple 正規化、`accept`/`reject`/`next` 実行
- `src/session/client-session.ts`: client payload の JSON array parse と NOTICE error 変換
- `src/session/upstream.ts`: upstream header と socket close helper

`src/pfortner.ts` の integration tests は public behavior の regression として残し、抽出 module は単体 test で境界を固定する。

## Server Runtime

production runtime は `src/server/*` が composition root である。`scripts/serve.ts` は削除済みで、production entrypoint は `src/server/main.ts` のみである。旧任意 config path 起動は廃止済みで、`deno task serve` も `src/server/main.ts` を起動する。

- `src/server/main.ts`: CLI/env top-level serve entrypoint。`createServerRuntime()` を作り、`Deno.serve()` へ main handler を渡す。
- `src/server/env.ts`: `PFORTNER_*` env と `--data-dir` を parse する。listen、logging、admin enable/token、trust proxy、Redis backend など runtime envelope の raw settings を所有する。
- `src/server/data_dir.ts`: dataDir layout を解決し、default `/data`、`config.yaml`、`admin-token`、Pipeline Workbench draft、KV、plugins、geoip の path を導出する。
- `src/server/admin_token.ts`: Admin 有効時だけ env/file/generated token を解決する。Admin 無効時は token file を読まず、生成もしない。
- `src/server/bootstrap.ts`: setup mode と normal mode を判定し、setup save 時の complete production config YAML と atomic no-overwrite publish を扱う。empty dataDir では `config.yaml` を作らず、missing `config.yaml` を setup-required state とする。
- `src/server/setup_app.ts`: setup mode 専用の最小 UI/API。Admin token login、Bearer/cookie auth、cookie CSRF guard を通したうえで、`upstream_relay` と relay metadata から production loader が受け付ける完全な config を生成する。
- `src/server/runtime.ts`: config、infra、registry、connection manager、shutdown manager、Admin state、runtime envelope を組み立てる production composition root。setup save 後の setup-to-normal transition もここで扱う。
- `src/server/handler.ts`: main port の route dispatcher。`/admin*`、`/health`、`/metrics`、relay info、relay WebSocket handler を runtime mode に応じて振り分ける。
- `src/server/types.ts`: `ParsedServerEnv`、`RuntimeEnvelope`、`AdminAuthState` など server runtime の共有 type。

production config は dataDir-owned な `/data/config.yaml` であり、production mode では任意 config path 指定を active path として扱わない。Docker image は `/data` volume を所有し、image build 中に Admin UI assets を生成して同梱する。

`src/config/starter.ts`、`src/config/manager.ts`、`src/config/runtime-guards.ts`、`src/config/pipeline-resolver.ts` は、server runtime から呼ばれる request handler/config internals である。`buildRequestHandler()` は config、infra、registry、hooks、runtime option を組み合わせ、guard 通過後に per-connection `pfortnerInit()` instance を作る。

## Admin Server

Fresh Admin UI source は `src/admin/ui/*` に置く。`src/admin/ui/main.ts` は repo-internal Admin UI entrypoint/re-export であり、`mod.ts` public API でも legacy compatibility facade でもない。

- `src/admin/ui/app/create_admin_app.ts`: Fresh `App` composition、middleware 接続、route registration。
- `src/admin/ui/app/fresh_runtime.ts`: programmatic Fresh app が返す response へ runtime marker を補う response adapter。
- `src/admin/ui/app/island_build_cache.ts`: Fresh `ProdBuildCache` へ admin client entry と island chunk URL を登録する manifest glue。
- `src/admin/ui/app/dashboard_model.ts`: Dashboard SSR 用の read model shaping。
- `src/admin/ui/http/*`: HTTP adapter/middleware layer。auth middleware、login routes、static middleware、Admin API route registration、JSON response helper をここに置く。
- `src/admin/ui/pages/*`: authenticated page route registration と renderer composition。`src/admin/ui/pages/page_routes.ts` が route map を持ち、`src/admin/ui/pages/renderers.tsx` が page renderer を作る。
- `src/admin/ui/routes/*.tsx`: Fresh page DOM の source of truth。
- `src/admin/ui/components/*`: sidebar、layout、page 共通 component。
- `src/admin/ui/client/fresh_nav.js`: admin-local partial navigation runtime の source。
- `src/admin/ui/islands/*`: Fresh island と island browser adapter、Pipeline Workbench UI。
- `src/admin/ui/static/*`: URL-addressed generated assets と static helper。
- `src/admin/ui/utils/*`: Admin UI 用の small client/server utility。
- `src/admin/ui/api_routes.ts`、`src/admin/ui/page_routes.ts`: 既存 import 向け compatibility facade。
- `src/admin/ui/security.ts`、`src/admin/ui/static_files.ts`、`src/admin/ui/route_types.ts`: UI HTTP layer から共有される auth/static/route support。
- `src/admin/ui/fresh_islands.ts`: 既存 import 向け compatibility facade。実体は `src/admin/ui/app/island_build_cache.ts` で、`ProdBuildCache` に `/admin/static/fresh_nav.js` と island chunk URL を登録する。

`/admin/static/...` は public HTTP URL として残る。一方で filesystem 上の source/generated assets は `src/admin/ui/static/*` に置く。たとえば public URL `/admin/static/fresh_nav.js` の source は `src/admin/ui/client/fresh_nav.js`、生成先は `src/admin/ui/static/fresh_nav.js` である。

`src/admin/ui/app/*` と `src/admin/ui/http/*` に新しい Admin API の business logic を追加しない。API の計算や read model は `src/admin/read_models/*`、mutation は `src/admin/actions/*` に置き、UI HTTP route は request/response 変換に留める。

## Admin Services

`src/admin/read_models/*` は state から read-only snapshot を作る module、`src/admin/actions/*` は mutation/domain action module である。top-level `src/admin/*.ts` service files は compatibility facades として残し、新しい実装の source of truth は subdirectory 側に置く。

- `src/admin/state.ts`: shared `AdminServiceState`。runtime-owned `adminAuth` と Admin UI 用 runtime state もここに含む。
- `src/admin/read_models/health.ts`: simple/detail health response。
- `src/admin/read_models/connections.ts`: Admin connection DTO。
- `src/admin/read_models/logs.ts`: log limit と buffer read model。
- `src/admin/read_models/config_view.ts`: secret masking。
- `src/admin/read_models/throughput.ts`: throughput snapshot。
- `src/admin/read_models/runtime.ts`: Admin UI 用 runtime envelope projection。logging、trust proxy、Admin enabled/token source を secret なしで返す。
- `src/admin/actions/connections.ts`: connection close/disconnect batch。
- `src/admin/actions/blocklist.ts`: blocklist add/delete/list mutation。Fresh API は strict string validation、Bearer compatibility handler は既存の truthy value / empty path semantics を保つ legacy action を使う。
- `src/admin/actions/pipelines.ts`、`pipeline_draft.ts`、`playground.ts`、`reload.ts`、`shutdown.ts`: Pipeline Workbench、config reload、shutdown の domain actions。
- `src/admin/http/log_stream.ts`: Admin logs SSE 用の shared response helper。UI route と legacy bearer handler の両方から使う例外的な HTTP helper。
- `src/admin/service.ts`: compatibility barrel。`src/admin/connections.ts`、`logs.ts`、`health.ts`、`config_view.ts`、`throughput.ts`、`pipeline_simulator.ts` も既存 import のための compatibility facade。
- `src/admin/server.ts`: bearer-token JSON/SSE handler の compatibility surface。内部では read model/action/log stream helper を使う。

新規 code は、互換が必要な場合を除いて top-level service facade ではなく `src/admin/read_models/*`、`src/admin/actions/*`、`src/admin/http/log_stream.ts` を直接 import する。Fresh Admin UI の request/response adapter は `src/admin/ui/http/*` に置き、domain read model/action とは分離する。

## Admin UI

Fresh 2.x + Preact が main port 上の `/admin` を serve する。Authenticated `/admin/*` page route は Fresh-rendered page を返し、`/admin/login` も Fresh SSR page として扱う。source client logic は `src/admin/ui/client/*` と `src/admin/ui/islands/*` に置き、`src/admin/ui/static/*` は URL-addressed output または static asset を基本とする。例外として legacy helper の `src/admin/ui/static/dom.js` は同階層の regression test のため残すが、新規 runtime code から import しない。

- `src/admin/ui/components/Sidebar.tsx`: shared sidebar と `Layout`。`body` に `f-client-nav` を付け、sidebar を Fresh `Partial` の `admin-sidebar`、`main` 内を `admin-content` として差し替え対象にする。
- `src/admin/ui/pages/page_routes.ts`: `/admin/`, `/admin/connections`, `/admin/pipelines`, `/admin/metrics`, `/admin/blocklist`, `/admin/config`, `/admin/logs` を page renderer map に登録する。
- `src/admin/ui/routes/*.tsx`: page DOM の source of truth。
- `src/admin/ui/client/fresh_nav.js`: programmatic Fresh App で空の client entry が出ることを避ける admin-local partial navigation runtime の source。Fresh の partial marker を使い、admin island static chunk mount を navigation 後に呼び直す。layout-level behavior として theme toggle を mount し、Dashboard page の polling/rendering、Connections page の fetch/filter/disconnect behavior、Metrics page の chart/raw viewer behavior、Logs page の runtime info/fallback/SSE behavior、Config page の read/reload behavior、Blocklist page の add/delete/list behavior も client entry 側で初期化する。
- `src/admin/ui/static/fresh_nav.js`: `src/admin/ui/client/fresh_nav.js` から `deno task build:admin-assets` で生成する URL-addressed client entry artifact。`/admin/static/fresh_nav.js` という public URL は Fresh SSR の `ProdBuildCache` と browser preload のために残すが、source of truth ではない。
- `src/admin/ui/fresh_islands.ts`: 既存 import 向け compatibility facade。実体は `src/admin/ui/app/island_build_cache.ts` で、`@fresh/core/internal` `ProdBuildCache` を使い、programmatic `/admin` app の client entry と island chunk URL を Fresh SSR に登録する。これは chunk URL の manifest であり、browser bundle は生成しない。
- `src/admin/ui/islands/PipelineWorkbench.tsx`: Pipeline Workbench の Fresh island composition root。SSR initial graph props、direction state、toolbar/palette/canvas/modal composition、save/load/publish/playground action dispatch を担う。
- `src/admin/ui/islands/PipelineWorkbench.browser.tsx`: `PipelineWorkbench.tsx` を browser で mount するための adapter source。`scripts/build_admin_islands.ts` / `deno task build:admin-assets` で `/admin/static/islands/PipelineWorkbench.js` へ bundle し、Fresh boot props を decode して SSR placeholder を Preact mount point に差し替える。
- `src/admin/ui/islands/pipeline/*`: graph canvas、toolbar、palette、modals、API client、reducer、viewport/minimap/canvas interaction hook、keyboard hook。
- `src/admin/ui/islands/pipeline/{graph.js,workbench_state.js,config_editor.js}`: Pipeline Workbench の pure helper 実体。Fresh island/reducer code は `src/admin/ui/static` の helper 実装を import しない。
- `src/admin/ui/static/islands/PipelineWorkbench.js`: `deno task build:admin-assets` の生成 output。programmatic Fresh app が URL-addressed island chunk を必要とする間だけ残す compatibility artifact で、source of truth は `src/admin/ui/islands/PipelineWorkbench.browser.tsx` と `src/admin/ui/islands/pipeline/*` である。

古い custom SPA shell (`AdminAppShell`、旧 `/admin/static/app.js`、`router.js`、`page_templates.js`) は active architecture から削除済みである。複雑な interactive UI は段階的に Fresh islands へ移す。

## Docs

`docs/*-goal-plan.md` は履歴と意思決定を残すための計画ファイルである。現在構造を確認するときはこの `docs/current-architecture.md` と `CLAUDE.md` を優先する。
