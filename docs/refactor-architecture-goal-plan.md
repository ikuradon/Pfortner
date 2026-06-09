# Refactor Architecture Goal Plan

作成日: 2026-06-09

## 最終目標

Pförtner の責務境界を明確化し、今後の Admin UI、policy runtime、connection lifecycle、config bootstrap の変更が互いに波及しにくい構造へ段階的に移行する。公開 API の破壊は必要な場合だけ明示的に行い、各 phase は単独で testable な atomic commit として完了させる。

## 現状の問題

### `admin/main.ts`

`admin/main.ts` は Fresh app factory であると同時に、以下をすべて抱えている。

- static file serving と cache header 判定
- login/logout cookie 発行
- Bearer/cookie auth
- CSRF / same-origin 判定
- authenticated page route 登録
- JSON/SSE/mutation API route 登録
- Playground pipeline evaluation request の変換
- blocklist mutation

このため Admin API を追加するだけでも auth、static、page routing の文脈を読む必要がある。

### `src/admin/service.ts`

`src/admin/service.ts` は Admin business logic の集合になっているが、実際には以下の異なる責務が同居している。

- config secret masking
- health summary/detail
- managed connection DTO conversion と close 操作
- throughput/log read model
- SSE log stream construction
- pipeline simulator
- simulator 用 CIDR 判定

特に pipeline simulator は policy runtime の近似実装であり、health/log/connection service と変更理由が異なる。

### `admin/static/app.js`

`admin/static/app.js` は SPA router と全 page の DOM template を同時に持つ。

- route table
- DOM helper
- page shell template
- page-specific DOM template
- dynamic import
- cleanup lifecycle
- navigation interception

page DOM を直す変更と router/cache/import lifecycle の変更が同じファイルに集中している。

### `src/config/starter.ts`

`src/config/starter.ts` は config から request handler を作る entry point だが、以下を抱えている。

- plugin config validation
- pipeline resolution
- pipelineResolver の再帰注入
- client IP selection
- draining / connection limit / runtime blocklist guard
- `pfortnerInit()` option assembly
- `ManagedConnection` adapter assembly
- connection unregister / upstreamPool notification
- malformed WebSocket upgrade error mapping

`buildRequestHandler()` が「起動時の組み立て」と「リクエスト時の runtime guard」の両方を持つ状態になっている。

### `src/pfortner.ts`

`src/pfortner.ts` は core public entry point である一方、以下が一体化している。

- client WebSocket session
- upstream `WebSocketStream`
- NIP-42 AUTH challenge/verification
- replay/rate/time validation
- client/server event emitter
- idle timeout
- blocklist enforcement
- client/server policy pipeline runner
- upstream-to-client relay
- shutdown/close lifecycle

core の安定性は高いが、AUTH や upstream relay だけを変更する場合でも大きな関数全体に触れる必要がある。

## 目標アーキテクチャ

### Admin server

`admin/main.ts` は Fresh app の assembly に絞る。

- `admin/security.ts`: cookie name、credential extraction、same-origin/CSRF helpers、login redirect/cookie helpers
- `admin/static_files.ts`: static file path resolution、content type、cache-control、file cache、static response
- `admin/page_routes.ts`: authenticated page route 登録
- `admin/api_routes.ts`: Admin API route 登録
- `admin/main.ts`: `App` 作成、middleware と route registrar の接続

### Admin services

`src/admin/service.ts` は thin barrel または small service 群へ分割する。

- `src/admin/health.ts`: `getHealthSimple()`, `getHealthDetail()`
- `src/admin/connections.ts`: DTO conversion, close single/batch
- `src/admin/logs.ts`: `parseLogLimit()`, `getLogs()`, `createLogStreamResponse()`
- `src/admin/config_view.ts`: `maskSecrets()`
- `src/admin/throughput.ts`: `getThroughputData()`
- `src/admin/pipeline_simulator.ts`: `simulatePipeline()` と simulator-only helpers
- `src/admin/service.ts`: 既存 import 互換の re-export

### SPA client

`admin/static/app.js` は router entry point に絞る。

- `admin/static/dom.js`: `el()`, `button()`, `table()`, `chartContainer()` などの shared DOM helper
- `admin/static/page_templates.js`: page DOM template registrar
- `admin/static/router.js`: normalize path、active nav、dynamic import、cleanup、History API
- `admin/static/app.js`: version propagation と boot

Page-specific modules は fetch/event binding/cleanup だけを担当する。

### Config/bootstrap

`src/config/starter.ts` は request handler assembly に絞る。

- `src/config/pipeline-resolver.ts`: plugin schema validation、direction validation、recursive pipeline resolver
- `src/config/runtime-guards.ts`: draining、connection limit、runtime blocklist
- `src/config/managed-connection-adapter.ts`: `pfortnerInit()` result から `ManagedConnection` を作る
- `src/config/starter.ts`: dependencies を組み合わせて handler を返す

### Core session

`src/pfortner.ts` は public API shell として残し、内部を段階的に抽出する。

- `src/session/events.ts`: event listener registry
- `src/session/auth.ts`: AUTH challenge validation、time/replay/attempt checks
- `src/session/pipeline-runner.ts`: policy tuple normalization と action handling
- `src/session/upstream.ts`: upstream socket lifecycle
- `src/session/client-session.ts`: client WebSocket lifecycle
- `src/pfortner.ts`: `pfortnerInit()` の public shape を維持して composition する

## 実行方針

1. 既存の外部挙動を守る refactor を優先する。
2. 各 phase は TDD で新しい module boundary の regression test を先に書く。
3. 既存 import 互換が必要な箇所は barrel export を残して、利用側を段階的に移す。
4. 各 phase の完了条件は format、lint、targeted tests、`src/` full tests、必要な admin root tests。
5. 各 phase は atomic commit にする。

## Phase Plan

### Phase 1: Admin server boundary

目的: `admin/main.ts` から auth/CSRF/static/page/API registration を分離し、Admin route assembly を読みやすくする。

作成/変更:

- Create `admin/security.ts`
- Create `admin/security.test.ts`
- Create `admin/static_files.ts`
- Create `admin/static_files.test.ts`
- Create `admin/page_routes.ts`
- Create `admin/api_routes.ts`
- Modify `admin/main.ts`
- Modify `admin/main.test.ts`
- Modify `src/admin/main_csrf.test.ts`

完了条件:

- `admin/main.ts` が Fresh app assembly と login route glue に集中する。
- auth/CSRF helper は `admin/security.test.ts` で直接検証できる。
- static helper は `admin/static_files.test.ts` で直接検証できる。
- 既存 Admin UI/API behavior が維持される。

### Phase 2: Admin service boundary

目的: `src/admin/service.ts` から pipeline simulator と read model services を分離する。

作成/変更:

- Create `src/admin/health.ts`
- Create `src/admin/connections.ts`
- Create `src/admin/logs.ts`
- Create `src/admin/config_view.ts`
- Create `src/admin/throughput.ts`
- Create `src/admin/pipeline_simulator.ts`
- Modify `src/admin/service.ts`
- Split or extend tests from `src/admin/service.test.ts`

完了条件:

- `simulatePipeline()` が `src/admin/pipeline_simulator.ts` に移る。
- `src/admin/service.ts` は re-export と shared state type のみに近づく。
- Admin API 側の import は必要に応じて小 module から直接読む。

### Phase 3: SPA router/template boundary

目的: `admin/static/app.js` を router boot に絞り、page DOM template と DOM helper を分離する。

作成/変更:

- Create `admin/static/dom.js`
- Create `admin/static/page_templates.js`
- Create `admin/static/router.js`
- Modify `admin/static/app.js`
- Add tests for version propagation and route template lookup

完了条件:

- `admin/static/app.js` は version propagation と `boot()` 呼び出しが中心になる。
- page template 変更が router lifecycle に触れずに済む。
- SPA import cache busting behavior は維持される。

### Phase 4: Config/runtime bootstrap boundary

目的: `src/config/starter.ts` を composition root に寄せる。

作成/変更:

- Create `src/config/pipeline-resolver.ts`
- Create `src/config/runtime-guards.ts`
- Create `src/config/managed-connection-adapter.ts`
- Modify `src/config/starter.ts`
- Split tests from `src/config/starter.test.ts`

完了条件:

- plugin validation/direction validation が resolver module に集約される。
- request-time guard は unit test 可能になる。
- `buildRequestHandler()` の本体が handler assembly と error mapping に絞られる。

### Phase 5: Core session boundary

目的: `src/pfortner.ts` の巨大 closure を小さな内部 module に分割する。

作成/変更:

- Create `src/session/events.ts`
- Create `src/session/auth.ts`
- Create `src/session/pipeline-runner.ts`
- Create `src/session/upstream.ts`
- Create `src/session/client-session.ts`
- Modify `src/pfortner.ts`
- Split tests from `src/pfortner.test.ts` where direct unit tests are possible

完了条件:

- `pfortnerInit()` の public return shape は維持される。
- AUTH、pipeline runner、event listener registry は単独 test 可能になる。
- existing `src/pfortner.test.ts` は integration regression として残る。

### Phase 6: Public API and docs cleanup

目的: export、docs、developer guidance を新構造に合わせる。

作成/変更:

- Modify `mod.ts`
- Modify `CLAUDE.md`
- Modify existing docs under `docs/`
- Add migration notes if public import paths change

完了条件:

- public exports は意図したものだけ。
- docs の architecture section が実装構造と一致する。
- `rg` で旧 module name や古い責務説明が残っていない。

## 全体検証

各 phase の最後に以下を実行する。

```bash
deno fmt --check
deno lint
deno check admin/static/app.js admin/static/app.test.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/static/app.test.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/
```

Sandbox 内で `Deno.serve()` が `PermissionDenied` になる場合は、同じ `deno test ... src/` を承認付きで sandbox 外実行する。

## リスクと制御

- Admin UI は browser cache と module import の影響を受けるため、SPA boot と dynamic import の検証を残す。
- `src/pfortner.ts` は public API に近いため、Phase 5 までは直接触らない。
- `src/admin/service.ts` の re-export を段階的に残し、既存 import を一度に壊さない。
- `mod.ts` の public export 変更は最後にまとめて判断する。
- 旧 behavior を守る refactor が主目的なので、機能追加は各 phase に混ぜない。
