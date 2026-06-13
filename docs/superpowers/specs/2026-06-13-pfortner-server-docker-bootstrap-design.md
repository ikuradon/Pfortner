# Pfortner Server Docker Bootstrap Design

作成日: 2026-06-13

## 目的

Pfortner Server を、任意の YAML path を指定して起動する CLI 寄りの server から、Admin UI を含む Docker 配布前提の relay gateway appliance へ移行する。

最終 UX は、Docker image を pull し、永続 volume を `/data` に mount して起動すれば、main port 上の `/admin` から初期設定と運用ができる状態である。Admin UI は production path の中心であり、設定ファイル編集を前提としたサンプル運用は残さない。

## 方針

起動単位は config path ではなく dataDir にする。production entrypoint は `scripts/serve.ts` ではなく `src/server/main.ts` に置き、`/data/config.yaml` は Pfortner が dataDir 内で管理する durable config として扱う。

env と config は同じ意味の設定を共有しない。

```text
env で設定できるものは config に存在しない。
config で設定できるものは env で上書きしない。
PFORTNER_INIT_* は採用しない。
```

env は deployment/runtime envelope、config は product behavior、dataDir は durable state を所有する。

## 非目標

- 旧 `scripts/serve.ts pfortner.yaml` production UX を互換維持しない。
- 任意 config path 指定を production entrypoint に残さない。
- `PFORTNER_INIT_*` のような初回だけ効く env を導入しない。
- config の値を env override で差し替える仕組みを導入しない。
- Admin UI を optional sample UI として扱わない。
- この設計だけで Admin UI の visual redesign を行わない。
- Deno compile の単一 binary 配布は初回対象にしない。今回の配布単位は Deno runtime container とする。

## Product UX

Docker run の基本形:

```sh
docker run \
  -p 3000:3000 \
  -v pfortner-data:/data \
  -e PFORTNER_ADMIN_ENABLED=true \
  pfortner/server
```

起動後、利用者は `http://localhost:3000/admin` にアクセスする。empty dataDir の場合は setup mode に入り、Admin UI で `upstream_relay` などの product config を作成する。

`PFORTNER_ADMIN_ENABLED=true` で、`PFORTNER_ADMIN_TOKEN` または `PFORTNER_ADMIN_TOKEN_FILE` が指定されていない場合、初回 bootstrap は強い token を生成し、`/data/admin-token` に保存する。起動 log には token 本体を出さず、保存先だけを出す。`PFORTNER_ADMIN_ENABLED=false` の場合は admin token を読まず、生成もしない。

## DataDir

default dataDir は `/data`。`PFORTNER_DATA_DIR` または `--data-dir` で変更できる。Docker image の標準 path は `/data` とし、Dockerfile は `VOLUME /data` を宣言する。

dataDir の最終形:

```text
/data/
  config.yaml
  admin-token
  pipeline-workbench.draft.json
  kv/
  plugins/
  geoip/
```

各 path の責務:

| Path                            | 所有者            | 用途                                |
| ------------------------------- | ----------------- | ----------------------------------- |
| `config.yaml`                   | config/Admin UI   | product behavior の durable config  |
| `admin-token`                   | bootstrap/runtime | auto-generated admin token          |
| `pipeline-workbench.draft.json` | Admin UI          | Pipeline Workbench draft            |
| `kv/`                           | runtime infra     | local Deno KV backend               |
| `plugins/`                      | config/Admin UI   | local plugin files                  |
| `geoip/`                        | runtime infra     | GeoIP database などの optional data |

`config.yaml` の path は dataDir から導出する。利用者が production entrypoint に arbitrary config path を渡す設計にはしない。

`config.yaml` は complete production config だけを表す。setup mode 中に incomplete config を `config.yaml` として書かない。empty dataDir では `config.yaml` が存在しないこと自体を setup-required state とし、setup save が成功した瞬間にだけ一時 file から atomic rename で `config.yaml` を作る。

## Env Ownership

env-only は deployment が決める項目である。Admin UI は表示してよいが、編集しない。

採用する env:

| Env                         | Default             | 責務                          |
| --------------------------- | ------------------- | ----------------------------- |
| `PFORTNER_DATA_DIR`         | `/data`             | durable state root            |
| `PFORTNER_LISTEN_ADDR`      | `[::]`              | listen address                |
| `PFORTNER_LISTEN_PORT`      | `3000`              | listen port                   |
| `PFORTNER_ADMIN_ENABLED`    | `true`              | Admin UI/API exposure control |
| `PFORTNER_ADMIN_TOKEN`      | unset               | admin auth token の直接指定   |
| `PFORTNER_ADMIN_TOKEN_FILE` | `/data/admin-token` | admin auth token file         |
| `PFORTNER_LOG_LEVEL`        | `info`              | process log level             |
| `PFORTNER_LOG_FORMAT`       | `text`              | process log format            |
| `PFORTNER_TRUST_PROXY`      | `false`             | proxy header trust policy     |
| `PFORTNER_REDIS_URL`        | unset               | Redis backend URL             |
| `PFORTNER_REDIS_URL_FILE`   | unset               | Redis backend URL file        |
| `PFORTNER_REDIS_KEY_PREFIX` | unset               | Redis key prefix              |

`PFORTNER_ADMIN_ENABLED=false` の場合、`/admin` と `/admin/api/*` は無効にする。main relay、`/health`、必要な public relay info endpoint は維持する。

`PFORTNER_ADMIN_ENABLED=true` のときだけ admin token を resolve する。`PFORTNER_ADMIN_TOKEN` と `PFORTNER_ADMIN_TOKEN_FILE` が両方ある場合は、secret を env に直接渡した明示性を優先し、`PFORTNER_ADMIN_TOKEN` を使う。Admin UI は token の値を表示しない。

`PFORTNER_ADMIN_ENABLED=false` の場合、`PFORTNER_ADMIN_TOKEN_FILE` の default path や指定 path が存在しなくても起動を止めない。Admin UI/API exposure が無効なので token は未使用である。

`PFORTNER_INIT_*` は採用しない。初回だけ使う seed env は、後から変更可能に見えず、Admin UI first の設定所有権とも衝突するためである。

Redis connection string のような secret-bearing runtime setting は env-only とする。config は secret や secret file path を保持しない。

## Config Ownership

config-only は Pfortner の product behavior である。Admin UI が編集し、runtime は reload 可能な config として読む。

config に残す項目:

| Config                                      | 責務                                       |
| ------------------------------------------- | ------------------------------------------ |
| `server.upstream_relay`                     | relay upstream                             |
| `server.upstream_raw_url`                   | upstream raw URL override                  |
| `server.relay` または既存 relay info fields | relay name/description/contact など        |
| `server.connections`                        | connection limit/pressure behavior         |
| `server.shutdown`                           | drain/force shutdown behavior              |
| `auth`                                      | NIP-42 auth behavior                       |
| `infra.metrics.prometheus.enabled`          | Prometheus endpoint enablement             |
| `infra.http`                                | relay-side HTTP timeout/user-agent         |
| `plugins`                                   | external plugin definitions                |
| `pipelines`                                 | client/server pipeline definitions         |
| runtime blocklist/policy config             | product behavior としての blocklist/policy |

local KV backend は dataDir state として扱い、default path は dataDir から導出する。Redis を使う場合は `PFORTNER_REDIS_URL` または `PFORTNER_REDIS_URL_FILE` を指定する。

config から落とす項目:

| 旧 Config                       | 移行先                                                    |
| ------------------------------- | --------------------------------------------------------- |
| `server.port`                   | `PFORTNER_LISTEN_PORT`                                    |
| `server.x_forwarded_for`        | `PFORTNER_TRUST_PROXY`                                    |
| listen hostname 相当            | `PFORTNER_LISTEN_ADDR`                                    |
| `admin.enabled`                 | `PFORTNER_ADMIN_ENABLED`                                  |
| `admin.port`                    | 削除。Admin UI は main port の `/admin`                   |
| `admin.auth_token`              | `PFORTNER_ADMIN_TOKEN` または `PFORTNER_ADMIN_TOKEN_FILE` |
| `admin.trust_proxy`             | `PFORTNER_TRUST_PROXY`                                    |
| `admin.path`                    | 削除。Admin UI は固定 `/admin`                            |
| `infra.redis.url`               | `PFORTNER_REDIS_URL` または `PFORTNER_REDIS_URL_FILE`     |
| `infra.redis.key_prefix`        | `PFORTNER_REDIS_KEY_PREFIX`                               |
| `infra.kv.path`                 | dataDir から導出                                          |
| `infra.metrics.logging`         | `PFORTNER_LOG_LEVEL` / `PFORTNER_LOG_FORMAT`              |
| `infra.metrics.prometheus.port` | 削除。`/metrics` は main port                             |
| `infra.metrics.prometheus.path` | 削除。metrics endpoint は固定 `/metrics`                  |

この分離により、Admin UI で変更した config が env によって黙って上書きされる状態を作らない。

production dataDir config では `${ENV}` placeholder 展開を行わない。旧 config path mode の env expansion は legacy behavior として削除対象にする。外部 secret が必要な場合は、config に `${REDIS_URL}` を書くのではなく、明示された `PFORTNER_*` env または file env を runtime が読む。

## Runtime Envelope And Admin State

env-only と dataDir-derived の値は config に戻さず、`src/server/env.ts` と `src/server/data_dir.ts` が runtime envelope として組み立てる。

runtime envelope の概念 model:

```ts
type RuntimeEnvelope = {
  dataDir: string;
  listen: { hostname: string; port: number };
  adminAuth: AdminAuthState;
  logging: { level: 'debug' | 'info' | 'warn' | 'error'; format: 'text' | 'json' };
  backend: {
    kv: { path: string };
    redis?: { url: string; keyPrefix?: string };
  };
};
```

`AdminServiceState` には runtime-owned auth state を追加する。

```ts
type AdminAuthState =
  | { enabled: false; path: '/admin'; trustProxy: boolean }
  | {
    enabled: true;
    path: '/admin';
    trustProxy: boolean;
    token: string;
    tokenSource: 'env' | 'file' | 'generated';
  };
```

Fresh auth middleware、login route、Bearer admin handler は `state.config.admin?.auth_token` や `state.config.admin?.trust_proxy` を読まない。production path では `state.adminAuth.enabled === true` のときだけ `state.adminAuth.token` を参照し、same-origin/CSRF 判定には `state.adminAuth.trustProxy` を参照する。移行中に legacy tests のため fallback を置く場合でも、production runtime は config に admin secret を投影しない。

setup mode は complete `PfortnerConfig` を持たないため、normal admin state と分ける。

```ts
type ServerRuntime =
  | { mode: 'setup'; runtime: RuntimeEnvelope; setup: SetupState }
  | { mode: 'normal'; runtime: RuntimeEnvelope; adminState: AdminServiceState };
```

setup mode の Admin UI は static/login/setup routes だけを登録し、operational pages は config 完成後に normal mode で登録する。

Admin runtime 情報は masked config API に混ぜない。Admin Logs など UI が env-owned runtime setting を表示する場合は、`src/admin/read_models/runtime.ts` の runtime read model を使う。Fresh Admin API は UI 専用の `GET /admin/api/runtime` で `logging.level` / `logging.format` を返す。Logs page は `config.infra.metrics.logging.level` ではなく runtime projection を参照する。

backend availability も runtime envelope で判定する。production config validation は `infra.redis.url` や `infra.kv.path` の有無ではなく、runtime envelope から渡された backend availability を見る。`backend: "kv"` を使う policy は dataDir-derived KV path が writable なら valid、`backend: "redis"` を使う policy は `PFORTNER_REDIS_URL` または `PFORTNER_REDIS_URL_FILE` が解決できる場合だけ valid とする。

## Bootstrap State Machine

起動時は `src/server/data_dir.ts` が dataDir を resolve し、`src/server/bootstrap.ts` が dataDir の状態を判定する。

```text
process start
  -> env parse
  -> dataDir resolve
  -> admin token resolve/generate
  -> config path = dataDir/config.yaml
  -> config exists?
       yes -> load and validate config -> normal mode, or fail fast on invalid config
       no  -> setup mode with in-memory SetupState
```

setup mode は `PfortnerConfig` loader に incomplete config を渡さない。`/data/config.yaml` が存在しない状態を setup-required とし、server は in-memory `SetupState` と runtime envelope だけで Admin setup UI を serve する。再起動しても `config.yaml` がない限り setup mode に戻る。

setup mode の動作:

- `/admin` は setup UI を表示する。
- setup UI は `upstream_relay` と最小 relay metadata を保存する。
- 保存時に complete production YAML を検証し、一時 file へ書いた後に `/data/config.yaml` へ atomic rename する。
- config 完成後、relay handler、upstream probe、ConfigManager を起動する。
- `upstream_relay` 未設定中の WebSocket relay request は `503` と明示 message を返す。
- `/health` は `status: "setup_required"` を返す。

normal mode の動作:

- `/data/config.yaml` を load して ConfigManager を作る。
- Admin UI は config editor と operational pages を提供する。
- config reload は dataDir 内の `config.yaml` だけを対象にする。
- SIGHUP reload は dataDir config を読む。

## Setup-Generated Config

setup save は、利用者入力をそのまま断片 config として保存しない。Admin UI の setup form が受け取る最小入力は `upstream_relay` と relay metadata だが、保存時は production loader が受け付ける complete YAML を生成する。

最小生成 YAML:

```yaml
server:
  upstream_relay: 'wss://relay.example.com'

relay_info:
  name: 'Pfortner Relay'
  description: ''

pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
```

`server.upstream_relay` は setup 入力から入れる。`relay_info.name` と `relay_info.description` は setup 入力があれば使い、未入力なら上記 default を使う。`pipelines.client` と `pipelines.server` は、初期状態で pass-through relay として動くように `accept` policy を 1 件ずつ入れる。

setup save はこの YAML を production schema で検証してから書く。`pipelines.client` / `pipelines.server` の配列補完を忘れた生成物は保存しない。

## Entrypoint Architecture

最終構成:

```text
src/
  server/
    main.ts
    runtime.ts
    env.ts
    data_dir.ts
    bootstrap.ts
    handler.ts
    admin_token.ts

  admin/
    actions/
    read_models/
      runtime.ts
    http/
    service.ts
    server.ts
    ui/
      app/
      http/
      pages/
      routes/
      islands/
      components/
      client/
      static/

scripts/
  build_admin_islands.ts
```

`src/server/main.ts` は CLI/env parse と top-level error handling だけを持つ。

`src/server/runtime.ts` は config、infra、registry、connection manager、shutdown manager、admin state を組み立てる composition root とする。現行 `scripts/serve.ts` の config mode logic はここへ移す。

`src/server/handler.ts` は main port handler を作る。routing order は以下に固定する。

```text
/admin*     -> Admin UI/API handler if PFORTNER_ADMIN_ENABLED=true
/health     -> runtime health
/metrics    -> prometheus if enabled
NIP-11      -> relay info
WebSocket   -> relay handler or setup_required 503
other HTTP  -> 400
```

`src/server/bootstrap.ts` は empty dataDir と setup mode を扱う。ConfigManager や Fresh route の詳細は持たない。

## Admin UI Relocation

root `admin/` は最終的に production source から外し、Admin UI source は `src/admin/ui/` に置く。

移動後の対応:

- `admin/app/*` -> `src/admin/ui/app/*`
- `admin/http/*` -> `src/admin/ui/http/*`
- `admin/pages/*` -> `src/admin/ui/pages/*`
- `admin/routes/*` -> `src/admin/ui/routes/*`
- `admin/components/*` -> `src/admin/ui/components/*`
- `admin/islands/*` -> `src/admin/ui/islands/*`
- `admin/client/*` -> `src/admin/ui/client/*`
- `admin/static/*` -> `src/admin/ui/static/*`

`src/admin/actions/*`、`src/admin/read_models/*`、`src/admin/http/log_stream.ts` は UI source ではなく admin domain/service source としてそのまま残す。

`admin/main.ts` など root `admin/` の compatibility facade は、実装中の段階移行に必要な短期間だけ許容する。最終 acceptance では production path と tests が `src/admin/ui/*` を参照し、root `admin/` は削除されるか、明示的に dev-only 互換として残す理由を持つ。

`deno.json` の lint exclude も移動に合わせる。generated static assets の出力先が `src/admin/ui/static/` になる phase では、`admin/static/` だけでなく `src/admin/ui/static/` も generated artifact として lint 対象から外す。root `admin/static/` を削除した後は古い exclude も削除する。

## Dockerfile

Docker image は Admin UI assets を含む完成物にする。

方針:

- Deno runtime image を pin する。
- dependency cache target は `src/server/main.ts` と admin asset build に合わせる。
- `deno task build:admin-assets` を image build 中に実行する。
- generated admin static assets は image に含める。
- `/data` を volume とする。
- `EXPOSE 3000`。
- `HEALTHCHECK` は `GET /health` を見る。
- `CMD` は `deno run ... src/server/main.ts` または `deno task serve` にするが、task は `src/server/main.ts` を指す。
- container は non-root user で実行する。

`scripts/serve.ts` は production entrypoint から外す。残す場合は local migration helper として名前を変え、任意 config path production UX を維持しない。

## Error Handling

起動時 env error:

- `PFORTNER_LISTEN_PORT` が number でない場合は fail fast。
- `PFORTNER_DATA_DIR` が作れない、または writable でない場合は fail fast。
- `PFORTNER_ADMIN_ENABLED=true` で token file が読めず、生成もできない場合は fail fast。
- `PFORTNER_ADMIN_ENABLED=false` の場合は admin token file を読まず、missing/unreadable token file で fail fast しない。
- `PFORTNER_ADMIN_ENABLED=false` かつ config が missing の場合は fail fast。Admin UI なしでは setup を完了できないため。

setup mode:

- relay WebSocket は `503 setup_required`。
- NIP-11 relay info は `503 setup_required` または setup placeholder を返す。初回実装では `503` を採用する。
- `/health` は `200` で `status: "setup_required"` を返す。container healthcheck は process が立ち上がっていることを示すため、setup_required を unhealthy 扱いにしない。

config save:

- setup UI の save は一時 file へ書いて atomic rename する。
- invalid config は保存しない。
- secret value は response/log に出さない。

runtime reload:

- reload 失敗時は既存 generation を維持する。
- Admin UI は reload error を表示し、config file の破損を隠さない。

## Testing Strategy

設計を実装するときは、phase ごとに targeted tests を追加してから移動する。

必須 regression:

- env parser:
  - admin enabled の valid env から listen/dataDir/admin enabled/token source が作られる。
  - admin enabled で invalid port と unreadable token source が fail fast になる。
  - admin disabled では token env/file を resolve せず、missing/unreadable token source で起動を止めない。
- dataDir/bootstrap:
  - empty dataDir で setup mode に入る。
  - setup mode entry は `/data/config.yaml` を作らない。
  - setup mode のまま再起動しても normal mode に誤判定しない。
  - existing config で normal mode に入る。
  - token が missing のとき `/data/admin-token` が生成される。
  - 既存 `/data/admin-token` がある場合、env 指定なしの再起動では同じ token file を再利用し、新しい token で上書きしない。
- config ownership:
  - `server.port`、`admin.enabled`、`admin.port`、`admin.auth_token` が production config schema から落ちる。
  - `PFORTNER_INIT_*` が env parser に存在しない。
  - production config loader は `${ENV}` placeholder 展開を行わない。
- runtime envelope:
  - `PFORTNER_ADMIN_TOKEN` / `PFORTNER_ADMIN_TOKEN_FILE` / generated token から `adminAuth` が作られる。
  - `PFORTNER_ADMIN_ENABLED=false` では `adminAuth` が disabled variant になり、`token` と `tokenSource` を持たない。
  - Fresh auth middleware、login route、Bearer admin handler が `state.adminAuth` を参照し、`state.config.admin?.auth_token` を参照しない。
  - `PFORTNER_TRUST_PROXY` が `adminAuth.trustProxy` に入り、CSRF same-origin 判定が config admin field に依存しない。
  - `PFORTNER_LOG_LEVEL` / `PFORTNER_LOG_FORMAT` が runtime read model に出る。
- backend validation:
  - `backend: "kv"` policy は dataDir-derived KV backend が available なら `infra.kv.path` なしで valid。
  - `backend: "redis"` policy は Redis env/file が解決できない場合 invalid。
  - Redis secret は masked config API に出ない。
- setup UI/API:
  - missing upstream では `/health` が `setup_required`。
  - setup save は `pipelines.client` と `pipelines.server` に `accept` policy を含む complete production YAML を生成する。
  - setup save 後に `/data/config.yaml` が完成し、normal runtime へ遷移できる。
- Admin Logs:
  - Logs page の log level 表示は runtime projection を参照し、masked config の `infra.metrics.logging` に依存しない。
- main handler:
  - `/admin` は admin enabled のときだけ serve される。
  - `/health` は main port 上で auth 不要。
  - `/metrics` は prometheus enabled のときだけ出る。
  - WebSocket は setup mode で `503`、normal mode で relay handler に渡る。
- Docker:
  - image build が admin assets を生成する。
  - container default command が `src/server/main.ts` を起動する。
  - healthcheck が `/health` を見る。
- Admin UI relocation:
  - Fresh SSR と Pipeline Workbench island chunk が `src/admin/ui/static/*` を参照する。
  - source code が root `admin/static/*` implementation を import しない。
  - `deno.json` lint exclude が generated output path の `src/admin/ui/static/` を含む。
  - root `admin/` production dependency が残っていないことを import boundary test で固定する。

既存 admin regression:

```sh
deno fmt --check --config deno.json
deno lint --config deno.json
deno check mod.ts src/server/main.ts src/admin/server.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/ src/config/ src/server/
deno task build:admin-assets
```

`deno task test` は最終 phase の full regression として実行する。socket bind 制約で失敗する環境では、bind error と unit regression を切り分ける。

## Migration Notes

実装順は、production entrypoint と dataDir bootstrap を先に作り、Admin UI relocation を後にする。

1. `src/server/*` を作り、現行 `scripts/serve.ts` の config mode logic を composition root へ移す。
2. env parser、dataDir resolver、admin token resolver を追加する。
3. `AdminServiceState` に `adminAuth` と runtime read model source を追加し、Fresh auth/login/Bearer handler を config token 参照から移す。
4. empty dataDir の setup mode と `/health` `setup_required` を追加する。setup mode では `/data/config.yaml` を作らない。
5. setup save が complete production YAML を生成する path を追加し、default pipelines を補完する。
6. production config schema から env-owned fields を落とし、backend validation に runtime backend availability を渡す。
7. Admin Logs の runtime setting 表示を config endpoint 参照から runtime read model 参照へ移す。
8. Dockerfile と `deno.json` tasks を `src/server/main.ts` 基準に更新する。
9. `admin/` root UI source を `src/admin/ui/` へ移し、Fresh asset build path と `deno.json` generated asset exclude を更新する。
10. root `admin/` と `scripts/serve.ts` の production usage を削除する。
11. `docs/current-architecture.md` を最終構成へ更新する。

各 phase は atomic commit にする。互換 facade を残す場合は、削除条件と production path から外れていることを同じ commit で明示する。

## Open Decisions Closed By This Design

- `PFORTNER_ADMIN_ENABLED` は採用する。
- `PFORTNER_INIT_*` は採用しない。
- `upstream_relay` は config-only とし、Admin UI setup で作る。
- setup mode 中は `/data/config.yaml` を作らない。
- setup save は `pipelines.client` / `pipelines.server` を含む complete YAML を生成する。
- env で設定できる項目は config から消す。
- config で設定できる項目は env override しない。
- admin auth token と trust proxy は `state.adminAuth` で扱い、config へ投影しない。
- admin disabled では token を解決しない。
- 既存 `/data/admin-token` は再起動時に再利用し、勝手に rotation しない。
- runtime logging display は config ではなく runtime read model で扱う。
- local KV backend は dataDir-derived runtime backend として validation に渡す。
- Admin UI は default enabled。
- arbitrary config path production mode は落とす。
- Docker image は Admin UI assets を含む。
