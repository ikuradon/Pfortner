# Admin First-Class Subsystem Design

作成日: 2026-06-12

## 目的

admin UI をサンプル由来の周辺実装ではなく、Pförtner の内部運用 UI として first-class subsystem にする。

今回の設計は、既存 URL、公開 export、auth、CSRF、static asset path、Fresh SSR、Pipeline Workbench の browser asset を維持しながら、`admin/main.ts`、`admin/api_routes.ts`、`src/admin/server.ts` に残る責務集中と重複を段階的に解くためのものである。

## 方針

段階移行を採用する。既存 file path は互換 facade として残し、実体を新しい境界へ移す。これにより、既存 import、test surface、未コミット作業との差分衝突を抑えつつ、最終的な module boundary を明確にする。

admin UI の格上げ先は、外部再利用可能 package ではなく、repo 内部の正式な運用 subsystem とする。公開 API を増やさず、内部構造の読みやすさ、テストしやすさ、変更時の局所性を優先する。

## 非目標

- admin UI の visual redesign は行わない。
- Fresh から別 framework へ移行しない。
- `/admin/*` URL、`/admin/static/*` asset URL、`/admin/api/*` の既存挙動を変更しない。
- `createAdminHandler`、`AdminState`、`AdminConnectionDto`、`AdminServiceState` の既存 admin public export を削除しない。
- Pipeline Workbench の機能追加や interaction 再設計は今回の主目的にしない。
- `admin/routes/*.tsx` の page component を全面移動しない。

## 最終構成

```text
admin/
  main.ts
  app/
    create_admin_app.ts
    dashboard_model.ts
    fresh_runtime.ts
    island_build_cache.ts
  http/
    api_routes.ts
    auth_middleware.ts
    json.ts
    login_routes.ts
    static_middleware.ts
  pages/
    page_routes.ts
    renderers.tsx
  components/
  routes/
  islands/
  client/
  static/

src/admin/
  server.ts
  state.ts
  read_models/
    health.ts
    config_view.ts
    connections.ts
    logs.ts
    throughput.ts
  actions/
    blocklist.ts
    connections.ts
    pipeline_draft.ts
    pipelines.ts
    playground.ts
    reload.ts
    shutdown.ts
  service.ts
```

既存の `admin/security.ts`、`admin/static_files.ts`、`admin/page_routes.ts`、`admin/api_routes.ts` は、移行中は残す。実装が `admin/http/*` や `admin/pages/*` へ移った後は、既存 import のための thin wrapper として扱う。

## 責務境界

### `admin/main.ts`

互換 entrypoint として `createAdminApp` を提供する。Fresh app assembly、middleware 登録、route 登録の実体は持たない。

### `admin/app/create_admin_app.ts`

Fresh `App` の composition root。static middleware、Fresh runtime patch、auth middleware、login/logout route、authenticated page route、admin API route を接続する。

この file は配線だけを扱う。dashboard props 生成、auth 判定、API action、static file serving の詳細を直接実装しない。

### `admin/app/fresh_runtime.ts`

programmatic Fresh app で必要な client entry patch を担当する。`/admin/static/fresh_nav.js`、modulepreload link、空 boot import の置換をここに閉じ込める。

### `admin/app/island_build_cache.ts`

programmatic Fresh app で必要な `ProdBuildCache` 登録を担当する。現行 `admin/fresh_islands.ts` の `installAdminIslandBuildCache()` 実装をここへ移し、`AdminIslandSmoke` と `PipelineWorkbench` の chunk URL を Fresh SSR に登録する。

既存 `admin/fresh_islands.ts` は `installAdminIslandBuildCache()` の export 名を維持し、`admin/app/island_build_cache.ts` へ委譲する wrapper として残す。

### `admin/app/dashboard_model.ts`

dashboard SSR に必要な health props を `AdminState` から作る。`admin/main.ts` から helper を外し、page renderer から再利用しやすい read model にする。

### `admin/http/*`

Fresh route context と `Request` / `Response` の変換を担当する。

- `json.ts`: JSON response helper。
- `auth_middleware.ts`: cookie credential、Bearer fallback が必要な箇所、login redirect、same-origin/CSRF 判定。
- `login_routes.ts`: `/admin/login` と `/admin/logout`。
- `static_middleware.ts`: `/admin/static/*` の serving。
- `api_routes.ts`: `/admin/api/*` の route registration。body、params、query を parse し、`src/admin/actions/*` の結果を HTTP response に変換する。

`admin/http/*` は YAML 更新や blocklist mutation の実体を持たない。

### `admin/pages/*`

authenticated page route の登録と page renderer mapping を担当する。

- `page_routes.ts`: route table と `app.get()` 登録。
- `renderers.tsx`: `DashboardPage`、`ConnectionsPage`、`PipelinesPage`、`MetricsPage`、`BlocklistPage`、`ConfigPage`、`LogsPage` へ props を渡す renderer の生成。

`admin/routes/*.tsx` は当面そのまま page component の source of truth とする。

### `src/admin/read_models/*`

admin UI と Bearer API が参照する読み取りモデルを置く。現在の `src/admin/health.ts`、`config_view.ts`、`connections.ts`、`logs.ts`、`throughput.ts` はこの役割に近い。移行時は `src/admin/read_models/*` に実体を移し、既存 top-level files は同じ export 名を維持する wrapper にする。

### `src/admin/actions/*`

admin mutation と domain action を置く。

- `blocklist.ts`: pubkey/IP blocklist の追加、削除、一覧。
- `connections.ts`: single close と batch disconnect。
- `pipeline_draft.ts`: Workbench draft の read/write/normalize。
- `pipelines.ts`: posted pipeline の normalize、YAML の pipeline 差し替え、reload、persist。
- `playground.ts`: posted message/pipeline/connectionInfo の normalize と pipeline simulation。
- `reload.ts`: config file reload。
- `shutdown.ts`: shutdown initiation。

actions は `Request` や Fresh context に依存しない。入力は plain object、出力は plain result object または domain error とする。

### `src/admin/server.ts`

Bearer token 用の既存 admin API entrypoint として残す。routing は維持してよいが、既存で Fresh admin API と重なる処理本体だけを `src/admin/actions/*` と read models に寄せる。

この refactor では Bearer API の公開面を増やさない。Fresh UI 専用 endpoint は Fresh UI 専用のまま残し、`src/admin/server.ts` に `pipeline-draft`、`pipelines`、`playground`、Prometheus text export、blocklist list endpoint を追加しない。

### `src/admin/service.ts`

互換 barrel として残す。新規 code は可能な限り実体 module を import する。外部互換が必要な export はここから継続する。

## Data Flow

Fresh admin UI の request flow:

```text
Request /admin/*
  -> admin/app/create_admin_app.ts
  -> admin/http/static_middleware.ts または auth_middleware.ts
  -> admin/pages/page_routes.ts または admin/http/api_routes.ts
  -> src/admin/read_models/* または src/admin/actions/*
  -> Response
```

Bearer API の request flow:

```text
Request /*
  -> src/admin/server.ts
  -> token check
  -> src/admin/read_models/* または src/admin/actions/*
  -> JSON Response
```

UI component と browser interaction の flow:

```text
admin/routes/*.tsx
  -> admin/components/*
  -> admin/islands/*
  -> admin/client/fresh_nav.js
  -> generated admin/static/*
```

`admin/static/*` は URL で直接配信される生成物または本物の static asset に限定する。source of truth の client logic は `admin/client/*` と `admin/islands/*` に置く。

## Endpoint Matrix

この refactor は endpoint parity を作るものではない。既存で重なる endpoint は共通 action/read model を使い、Fresh UI 専用 endpoint は Bearer API に追加しない。

| Capability                  | Fresh admin API                                  | Bearer API                             | Refactor rule                                      |
| --------------------------- | ------------------------------------------------ | -------------------------------------- | -------------------------------------------------- |
| health summary              | `GET /admin/api/health`                          | `GET /health`                          | shared health snapshot + adapter projection        |
| health detail               | `GET /admin/api/health/detail`                   | `GET /health/detail`                   | shared health snapshot + adapter projection        |
| masked config               | `GET /admin/api/config`                          | `GET /config`                          | shared read model                                  |
| plugin list                 | `GET /admin/api/plugins`                         | `GET /plugins`                         | shared read model                                  |
| connection list             | `GET /admin/api/connections`                     | `GET /connections`                     | shared read model                                  |
| connection batch disconnect | `POST /admin/api/connections/disconnect-batch`   | `POST /connections/disconnect-batch`   | shared `connections` action                        |
| connection single close     | none                                             | `DELETE /connections/:id`              | shared `connections` action, Bearer-only route     |
| throughput metrics          | `GET /admin/api/metrics/throughput`              | `GET /metrics/throughput`              | shared read model                                  |
| logs snapshot               | `GET /admin/api/logs`                            | `GET /logs`                            | shared read model                                  |
| logs stream                 | `GET /admin/api/logs/stream`                     | `GET /logs/stream`                     | shared stream helper                               |
| blocklist add/delete        | `POST`/`DELETE /admin/api/blocklist/{pubkey,ip}` | `POST`/`DELETE /blocklist/{pubkey,ip}` | shared `blocklist` action                          |
| config reload               | `POST /admin/api/reload`                         | `POST /reload`                         | shared `reload` action, different response shape   |
| shutdown                    | `POST /admin/api/shutdown`                       | `POST /shutdown`                       | shared `shutdown` action, different response shape |
| Prometheus text export      | `GET /admin/api/metrics/prometheus`              | none                                   | Fresh-only                                         |
| blocklist list              | `GET /admin/api/blocklist`                       | none                                   | Fresh-only                                         |
| pipeline draft              | `GET`/`POST /admin/api/pipeline-draft`           | none                                   | Fresh-only                                         |
| pipeline save               | `POST /admin/api/pipelines`                      | none                                   | Fresh-only                                         |
| playground evaluate         | `POST /admin/api/playground/evaluate`            | none                                   | Fresh-only                                         |

## Read Model Projection Rule

shared read model は内部 snapshot を返す。HTTP payload を完全共通化するものではない。HTTP adapter は、その snapshot を既存 response shape へ projection する。

health endpoint は特に互換を固定する。

- Fresh `GET /admin/api/health` は既存 Fresh API payload を維持する。
- Bearer `GET /health` は `status`、`connections`、`pressure` を維持する。
- Fresh `GET /admin/api/health/detail` は既存 Fresh API payload を維持する。
- Bearer `GET /health/detail` は `uptime_seconds`、`connections`、`upstream`、`memory` の既存 shape と fallback behavior を維持する。

Phase 6 では、Bearer health response を `src/admin/read_models/health.ts` の raw result に置き換えない。state inspection logic だけを共有し、`src/admin/server.test.ts` を payload compatibility gate として維持する。

## Error Handling

actions は domain error を文字列 message と status hint で返す。HTTP adapter はそれを `json({ error }, status)`、redirect、または plain text response に変換する。

pipeline save は現行挙動を維持し、reload validation が失敗した場合は config file を書き換えない。YAML 内の env placeholder は、pipeline 以外の領域で展開済み値に置換しない。

auth failure は現行どおり、page route は login redirect、Fresh API は `401` JSON、CSRF failure は `403` とする。Bearer API は missing/wrong token を `401` JSON とする。

## Migration Plan

### Phase 1: entrypoint を薄くする

`admin/app/create_admin_app.ts`、`admin/app/fresh_runtime.ts`、`admin/app/island_build_cache.ts`、`admin/app/dashboard_model.ts` を作る。`admin/main.ts` は `createAdminApp` の facade にする。既存 `admin/fresh_islands.ts` は `installAdminIslandBuildCache()` の wrapper にする。

完了条件:

- `admin/main.ts` に Fresh runtime patch や dashboard helper の実体が残らない。
- `admin/app/create_admin_app.ts` が `installAdminIslandBuildCache()` を呼び、PipelineWorkbench island chunk の SSR 登録が維持される。
- `admin/main.test.ts` が通る。
- URL、auth、SSR HTML、Fresh client entry、island bundle path が変わらない。

### Phase 2: HTTP shell を分ける

`admin/http/json.ts`、`admin/http/auth_middleware.ts`、`admin/http/login_routes.ts`、`admin/http/static_middleware.ts` を作る。

完了条件:

- `admin/app/create_admin_app.ts` は HTTP middleware/route registration を呼び出すだけになる。
- `admin/security.ts` と `admin/static_files.ts` は既存 export 名を維持し、実装を `admin/http/*` へ委譲する wrapper として残る。
- login/logout、static serving、cookie auth、CSRF の既存テストが通る。

### Phase 3: page registration を `admin/pages` へ移す

`admin/pages/page_routes.ts` と `admin/pages/renderers.tsx` を作る。既存 `admin/page_routes.ts` は wrapper にする。

完了条件:

- page route table と renderer mapping が `admin/pages/*` にある。
- `admin/routes/*.tsx` はそのまま page DOM source of truth として残る。
- `admin/page_routes.test.ts` と `admin/main.test.ts` が通る。

### Phase 4: read model を `src/admin/read_models` へ移す

`src/admin/health.ts`、`src/admin/config_view.ts`、`src/admin/connections.ts`、`src/admin/logs.ts`、`src/admin/throughput.ts` の実体を `src/admin/read_models/*` へ移す。既存 top-level files は同じ export 名を維持する wrapper にする。

完了条件:

- `src/admin/read_models/health.ts`、`config_view.ts`、`connections.ts`、`logs.ts`、`throughput.ts` に実体がある。
- 既存 `src/admin/health.ts`、`config_view.ts`、`connections.ts`、`logs.ts`、`throughput.ts` は wrapper として残り、既存 import を壊さない。
- shared read model は raw snapshot を返し、Fresh API と Bearer API の HTTP payload shape は adapter 側 projection で維持される。
- `src/admin/connections.test.ts`、`src/admin/logs.test.ts`、`src/admin/service.test.ts`、`src/admin/server.test.ts` が通る。

### Phase 5: API action を `src/admin/actions` へ移す

`admin/api_routes.ts` の connection batch disconnect、pipeline save、pipeline draft、playground evaluate、blocklist mutation、reload、shutdown を action module へ抽出する。Fresh route registrar の実体は `admin/http/api_routes.ts` へ移し、既存 `admin/api_routes.ts` は wrapper にする。

完了条件:

- `admin/http/api_routes.ts` が body/params/query parse と response 変換だけを担当する。
- connection batch disconnect、pipeline YAML 更新、draft normalize、playground normalize、blocklist mutation、reload、shutdown は `src/admin/actions/*` にある。
- `admin/api_routes.test.ts` が通る。
- pipeline save failure 時に config file が unchanged である既存保証が通る。

### Phase 6: Bearer API を共通 action に寄せる

`src/admin/server.ts` の既存 route handler が `src/admin/actions/*` と read models を使うようにする。Bearer API に Fresh-only endpoint は追加しない。

完了条件:

- Fresh admin API と Bearer API の既存で重なる処理の重複実装がなくなる。
- Bearer health endpoint は shared health snapshot を使いつつ、既存 Bearer payload shape を adapter projection で維持する。
- Bearer-only の `DELETE /connections/:id` と shared の `POST /connections/disconnect-batch` は同じ `src/admin/actions/connections.ts` を使う。
- `pipeline-draft`、`pipelines`、`playground`、Prometheus text export、blocklist list の Bearer route は追加されない。
- `src/admin/server.test.ts` が通る。
- `mod.ts` の public export は互換維持される。

### Phase 7: docs と境界テストを更新する

`docs/current-architecture.md` と `CLAUDE.md` の admin section を更新する。`admin/import_boundary.test.ts` を追加し、`admin/app/*`、`admin/http/*`、`admin/pages/*`、`admin/static/*` の禁止 import 関係を固定する。

完了条件:

- 現行構造の一次資料が新 boundary を説明している。
- `admin/static` を source module として import しない方針がテストまたは docs で固定される。
- format、lint、targeted tests、可能なら full test が通る。

## Test Strategy

各 phase で targeted tests を先に走らせ、最後に広い検証を行う。

主要 command:

```bash
deno fmt --check --config deno.json
deno lint --config deno.json
deno check mod.ts admin/main.ts admin/api_routes.ts src/admin/server.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/api_routes.test.ts admin/page_routes.test.ts admin/security.test.ts admin/static_files.test.ts src/admin/main_csrf.test.ts src/admin/server.test.ts src/admin/service.test.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/ src/admin/
```

full test は次を使う。

```bash
deno task test
```

実行環境で socket bind が制限される場合は、`PermissionDenied` または `Operation not permitted` を実装バグと断定せず、targeted tests の結果と失敗箇所を分けて報告する。

## Acceptance Criteria

- `admin/main.ts`、`admin/api_routes.ts`、`admin/page_routes.ts` は互換 facade になっている。
- `admin/app/*` が Fresh app composition を担う。
- `admin/http/*` が HTTP adapter と middleware を担う。
- `admin/pages/*` が authenticated page route registration を担う。
- `src/admin/read_models/*` が読み取りモデルの実体を担い、既存 top-level read model files は互換 wrapper になっている。
- `src/admin/actions/*` が mutation と domain action を担う。
- Fresh admin API と `src/admin/server.ts` の Bearer API が、既存で重なる処理について共通 actions/read models を使う。
- Bearer health endpoint の payload shape は既存互換を維持している。
- Fresh-only endpoint は Bearer API に追加されていない。
- 既存 URL、public exports、auth/CSRF/static/login/logout、Pipeline Workbench asset path は変わらない。
- `docs/current-architecture.md` と `CLAUDE.md` が新構造を説明している。
- 既存の未コミット変更を巻き戻さず、リファクタ差分を phase ごとに atomic commit できる。

## Risks

既存 worktree に admin と policy の未コミット変更がある。実装時は作業前に差分を確認し、ユーザー変更を巻き戻さない。特に `admin/api_routes.ts`、`admin/client/fresh_nav.js`、generated static bundle は衝突しやすい。

`admin/static/fresh_nav.js` と `admin/static/islands/PipelineWorkbench.js` は generated artifact である。source を変更した phase では `deno task build:admin-assets` を実行し、生成物を同じ commit に含める。

`src/admin/server.ts` は public export 経由で使われる可能性がある。path や export 名は維持し、挙動差分は tests で固定する。
