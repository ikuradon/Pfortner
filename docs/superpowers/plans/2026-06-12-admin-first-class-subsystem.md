# Admin First-Class Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin UI を repo 内部の正式な運用 subsystem として再境界化し、既存 URL・public export・auth/CSRF・Fresh SSR・Pipeline Workbench asset path を維持したまま `admin/main.ts`、`admin/api_routes.ts`、`src/admin/server.ts` の責務集中を解く。

**Architecture:** `admin/` は Fresh app composition、HTTP adapter、page registration を担う。`src/admin/read_models/*` は読み取り snapshot、`src/admin/actions/*` は mutation/domain action、`src/admin/http/*` は共有 HTTP helper を担う。既存 top-level files は互換 facade として残し、phase ごとに tests と atomic commit で境界を固定する。

**Tech Stack:** Deno, Fresh 2.x, Preact, TypeScript, Deno test, Deno fmt/lint/check, existing admin static asset build.

---

## 前提

- 承認済み spec: `docs/superpowers/specs/2026-06-12-admin-first-class-subsystem-design.md`
- 現行構造確認: `docs/current-architecture.md`
- 既存 worktree には admin と policy の未コミット変更がある。各 task の最初に `git status --short` を確認し、対象外の差分を stage しない。
- `deno` が PATH で見つからない環境では `/root/.local/share/mise/installs/deno/2.8.3/bin/deno` を使う。以下の plan では読みやすさのため `deno` と書く。

## File Structure

最終的に新規作成または実体化する files:

- `admin/app/create_admin_app.ts`: Fresh `App` assembly。middleware、login/logout、page route、API route を接続する。
- `admin/app/dashboard_model.ts`: Dashboard SSR props の read model projection。
- `admin/app/fresh_runtime.ts`: empty Fresh boot import と modulepreload link の admin client entry patch。
- `admin/app/island_build_cache.ts`: admin island chunk URL を Fresh `ProdBuildCache` に登録する。
- `admin/http/json.ts`: Fresh admin HTTP adapter 用 JSON response helper。
- `admin/http/auth_middleware.ts`: cookie/Bearer auth、login redirect、CSRF response 変換。
- `admin/http/login_routes.ts`: `/admin/login` と `/admin/logout` registration。
- `admin/http/static_middleware.ts`: `/admin/static/*` middleware factory。
- `admin/http/api_routes.ts`: `/admin/api/*` Fresh route registrar。body/params/query を actions/read models へ渡す adapter。
- `admin/pages/page_routes.ts`: authenticated page route table。
- `admin/pages/renderers.tsx`: page component renderer mapping。
- `admin/import_boundary.test.ts`: admin subsystem import boundary regression。
- `src/admin/read_models/health.ts`: shared health snapshot helpers。
- `src/admin/read_models/config_view.ts`: secret masking。
- `src/admin/read_models/connections.ts`: `AdminConnectionDto`、`toAdminConnectionDto()`、`getConnections()`。
- `src/admin/read_models/logs.ts`: `parseLogLimit()`、`getLogs()`。
- `src/admin/read_models/throughput.ts`: throughput read model。
- `src/admin/actions/blocklist.ts`: blocklist list/add/delete actions。
- `src/admin/actions/connections.ts`: single close と batch disconnect actions。
- `src/admin/actions/pipeline_draft.ts`: Workbench draft normalize/read/write actions。
- `src/admin/actions/pipelines.ts`: pipeline payload normalize、YAML 差し替え、reload、persist。
- `src/admin/actions/playground.ts`: playground request normalize と `simulatePipeline()`。
- `src/admin/actions/reload.ts`: config reload action。
- `src/admin/actions/shutdown.ts`: shutdown initiation action。
- `src/admin/http/log_stream.ts`: shared SSE `Response` helper。

既存 facade として残す files:

- `admin/main.ts`: `createAdminApp` の互換 entrypoint。
- `admin/api_routes.ts`: `admin/http/api_routes.ts` の wrapper。
- `admin/page_routes.ts`: `admin/pages/page_routes.ts` の wrapper。
- `admin/fresh_islands.ts`: `admin/app/island_build_cache.ts` の wrapper。
- `admin/security.ts`: existing security helper export surface を維持する。Phase 2 で `admin/http/auth_middleware.ts` がここを利用する。
- `admin/static_files.ts`: existing static helper export surface を維持する。Phase 2 で `admin/http/static_middleware.ts` がここを利用する。
- `src/admin/health.ts`, `config_view.ts`, `connections.ts`, `logs.ts`, `throughput.ts`, `pipeline_draft.ts`, `pipeline_simulator.ts`: top-level compatibility facade。
- `src/admin/service.ts`: compatibility barrel。
- `src/admin/server.ts`: Bearer API entrypoint。公開 API を増やさず、既存 endpoint の処理本体だけを共通 action/read model に寄せる。

## Task 1: App Composition を `admin/app` に分離する

**Files:**

- Create: `admin/app/create_admin_app.ts`
- Create: `admin/app/dashboard_model.ts`
- Create: `admin/app/fresh_runtime.ts`
- Create: `admin/app/island_build_cache.ts`
- Modify: `admin/main.ts`
- Modify: `admin/fresh_islands.ts`
- Test: `admin/main.test.ts`

- [ ] **Step 1: 作業前状態を確認する**

Run:

```bash
git status --short
```

Expected: 既存の dirty files が表示される。Task 1 で stage するのは `admin/app/*`、`admin/main.ts`、`admin/fresh_islands.ts`、Task 1 で変更した test file だけ。

- [ ] **Step 2: red test を追加する**

`admin/main.test.ts` に facade と app module の存在を固定する test を追加する。

```ts
Deno.test('admin main entrypoint delegates to first-class app module', async () => {
  const main = await import('./main.ts');
  const appModule = await import('./app/create_admin_app.ts');

  assertEquals(main.createAdminApp, appModule.createAdminApp);
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts
```

Expected: FAIL。`./app/create_admin_app.ts` が存在しないため module resolution error になる。

- [ ] **Step 3: `admin/app/fresh_runtime.ts` を作る**

Create `admin/app/fresh_runtime.ts`:

```ts
const EMPTY_FRESH_BOOT_IMPORT = 'import { boot } from ' + '"";';
const ADMIN_FRESH_NAV_SCRIPT = '/admin/static/fresh_nav.js';
const EMPTY_MODULE_PRELOAD_LINK = '<>; rel="modulepreload"; as="script"';
const ADMIN_FRESH_NAV_PRELOAD_LINK = `<${ADMIN_FRESH_NAV_SCRIPT}>; rel="modulepreload"; as="script"`;

export async function withAdminFreshRuntime(response: Response): Promise<Response> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  if (!html.includes(EMPTY_FRESH_BOOT_IMPORT)) {
    return new Response(html, response);
  }

  const headers = new Headers(response.headers);
  const link = headers.get('Link');
  if (link?.includes(EMPTY_MODULE_PRELOAD_LINK)) {
    headers.set(
      'Link',
      link.replaceAll(EMPTY_MODULE_PRELOAD_LINK, ADMIN_FRESH_NAV_PRELOAD_LINK),
    );
  }

  return new Response(
    html.replaceAll(
      EMPTY_FRESH_BOOT_IMPORT,
      `import { boot } from "${ADMIN_FRESH_NAV_SCRIPT}";`,
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}
```

- [ ] **Step 4: `admin/app/dashboard_model.ts` を作る**

Create `admin/app/dashboard_model.ts`:

```ts
import { getHealthDetail } from '$admin/service.ts';
import type { AdminState } from '$admin/server.ts';
import type { DashboardPage } from '../routes/index.tsx';

export type DashboardHealth = Parameters<typeof DashboardPage>[0]['health'];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function buildDashboardHealth(state: AdminState): DashboardHealth {
  const detail = getHealthDetail(state);
  const connections = asRecord(detail.connections);
  const upstream = asRecord(detail.upstream);
  const memory = asRecord(detail.memory);

  return {
    status: stringOr(detail.status, 'ok'),
    connections: {
      active: numberOr(connections.active, state.connections.size),
      max: numberOr(connections.max, 0),
      pressure: stringOr(connections.pressure, 'normal'),
    },
    upstream: {
      status: stringOr(upstream.status, 'unknown'),
      latency_ms: nullableNumber(upstream.latency_ms),
    },
    uptime_seconds: nullableNumber(detail.uptime_seconds),
    memory: detail.memory === null ? null : {
      rss: numberOr(memory.rss, 0),
      heapUsed: numberOr(memory.heapUsed, 0),
    },
  };
}
```

- [ ] **Step 5: `admin/app/island_build_cache.ts` を作る**

Move the existing `admin/fresh_islands.ts` implementation body into `admin/app/island_build_cache.ts`. Use this content:

```ts
import type { App } from '@fresh/core';
import { IslandPreparer, ProdBuildCache, setBuildCache } from '@fresh/core/internal';
import * as AdminIslandSmokeModule from '../islands/AdminIslandSmoke.tsx';
import * as PipelineWorkbenchModule from '../islands/PipelineWorkbench.tsx';

type AdminIslandModule = Record<string, unknown>;

interface AdminIslandSpec {
  module: AdminIslandModule;
  chunk: string;
  name: string;
}

const ADMIN_ISLAND_VERSION = 'admin-islands-v1';
const ADMIN_CLIENT_ENTRY = '/admin/static/fresh_nav.js';
const ADMIN_ISLAND_SMOKE_CHUNK = '/admin/static/islands/AdminIslandSmoke.js';

const ADMIN_ISLANDS: AdminIslandSpec[] = [
  {
    module: AdminIslandSmokeModule,
    chunk: ADMIN_ISLAND_SMOKE_CHUNK,
    name: 'AdminIslandSmoke',
  },
  {
    module: PipelineWorkbenchModule,
    chunk: '/admin/static/islands/PipelineWorkbench.js',
    name: 'PipelineWorkbench',
  },
];

export function installAdminIslandBuildCache(app: App<unknown>): void {
  const islands = new Map();
  const preparer = new IslandPreparer();
  for (const spec of ADMIN_ISLANDS) {
    preparer.prepare(islands, spec.module, spec.chunk, spec.name, []);
  }

  const cache = new ProdBuildCache('.', {
    version: ADMIN_ISLAND_VERSION,
    clientEntry: ADMIN_CLIENT_ENTRY,
    fsRoutes: [],
    staticFiles: new Map(),
    islands,
    entryAssets: [],
  });

  setBuildCache(app, cache, 'production');
}
```

- [ ] **Step 6: `admin/fresh_islands.ts` を wrapper にする**

Replace `admin/fresh_islands.ts` with:

```ts
export { installAdminIslandBuildCache } from './app/island_build_cache.ts';
```

- [ ] **Step 7: `admin/app/create_admin_app.ts` を作る**

Move `createAdminApp()` from `admin/main.ts` into `admin/app/create_admin_app.ts`. The imports must point at existing modules with `../` paths:

```ts
import { App } from '@fresh/core';
import { h } from 'preact';
import { json } from '$admin/server.ts';
import type { AdminState } from '$admin/server.ts';
import { BlocklistPage } from '../routes/blocklist.tsx';
import { ConfigPage } from '../routes/config.tsx';
import { ConnectionsPage } from '../routes/connections.tsx';
import { DashboardPage } from '../routes/index.tsx';
import { LoginPage } from '../routes/login.tsx';
import { LogsPage } from '../routes/logs.tsx';
import { MetricsPage } from '../routes/metrics.tsx';
import { PipelinesPage } from '../routes/pipelines.tsx';
import { registerAdminApiRoutes } from '../api_routes.ts';
import { registerAdminPageRoutes } from '../page_routes.ts';
import {
  buildAdminCookie,
  clearAdminCookie,
  getCredentialFromRequest,
  getSafeLoginNext,
  isSameOriginRequest,
  needsCookieCsrfCheck,
  redirectToLogin,
} from '../security.ts';
import { createStaticFileServer } from '../static_files.ts';
import { buildDashboardHealth } from './dashboard_model.ts';
import { withAdminFreshRuntime } from './fresh_runtime.ts';
import { installAdminIslandBuildCache } from './island_build_cache.ts';
```

Keep the `STATIC_DIR`, `staticFiles`, `currentPath()`, middleware registration, login/logout route registration, `registerAdminPageRoutes()`, `registerAdminApiRoutes()`, and `return app.handler()` logic identical to the current `admin/main.ts`, except imports now come from the files above.

- [ ] **Step 8: `admin/main.ts` を facade にする**

Replace `admin/main.ts` with:

```ts
/**
 * Admin UI — Fresh 2.x app factory.
 * Creates a request handler for the /admin/* sub-path.
 */
export { createAdminApp } from './app/create_admin_app.ts';
```

- [ ] **Step 9: Task 1 verification を実行する**

Run:

```bash
deno fmt --check --config deno.json admin/main.ts admin/app/create_admin_app.ts admin/app/dashboard_model.ts admin/app/fresh_runtime.ts admin/app/island_build_cache.ts admin/fresh_islands.ts admin/main.test.ts
deno check admin/main.ts admin/app/create_admin_app.ts admin/app/dashboard_model.ts admin/app/fresh_runtime.ts admin/app/island_build_cache.ts admin/fresh_islands.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts
```

Expected: all commands exit `0`.

- [ ] **Step 10: Task 1 commit**

```bash
git add admin/main.ts admin/app/create_admin_app.ts admin/app/dashboard_model.ts admin/app/fresh_runtime.ts admin/app/island_build_cache.ts admin/fresh_islands.ts admin/main.test.ts
git commit -m "refactor: split admin app composition"
```

## Task 2: HTTP Shell を `admin/http` に分離する

**Files:**

- Create: `admin/http/json.ts`
- Create: `admin/http/static_middleware.ts`
- Create: `admin/http/auth_middleware.ts`
- Create: `admin/http/login_routes.ts`
- Modify: `admin/app/create_admin_app.ts`
- Test: `admin/main.test.ts`
- Test: `admin/security.test.ts`
- Test: `admin/static_files.test.ts`
- Test: `src/admin/main_csrf.test.ts`

- [ ] **Step 1: red test を追加する**

`admin/main.test.ts` に HTTP module の existence gate を追加する。

```ts
Deno.test('admin app composes through first-class HTTP modules', async () => {
  const jsonModule = await import('./http/json.ts');
  const authModule = await import('./http/auth_middleware.ts');
  const loginModule = await import('./http/login_routes.ts');
  const staticModule = await import('./http/static_middleware.ts');

  assertEquals(typeof jsonModule.json, 'function');
  assertEquals(typeof authModule.createAdminAuthMiddleware, 'function');
  assertEquals(typeof loginModule.registerAdminLoginRoutes, 'function');
  assertEquals(typeof staticModule.createAdminStaticMiddleware, 'function');
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts
```

Expected: FAIL because `admin/http/*` files do not exist.

- [ ] **Step 2: `admin/http/json.ts` を作る**

```ts
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 3: `admin/http/static_middleware.ts` を作る**

```ts
import { createStaticFileServer } from '../static_files.ts';

type FreshMiddlewareContext = {
  req: Request;
  next(): Promise<Response>;
};

export function createAdminStaticMiddleware(
  staticDir: string,
  adminPath: string,
): (ctx: FreshMiddlewareContext) => Promise<Response> {
  const staticFiles = createStaticFileServer(staticDir);
  return async (ctx) => {
    const url = new URL(ctx.req.url);
    const path = url.pathname;
    if (path.startsWith(`${adminPath}/static/`)) {
      const relativePath = path.slice(`${adminPath}/static`.length);
      return await staticFiles.serve(relativePath);
    }
    return await ctx.next();
  };
}
```

- [ ] **Step 4: `admin/http/auth_middleware.ts` を作る**

```ts
import type { AdminState } from '$admin/server.ts';
import { json } from './json.ts';
import { getCredentialFromRequest, isSameOriginRequest, needsCookieCsrfCheck, redirectToLogin } from '../security.ts';

type FreshMiddlewareContext = {
  req: Request;
  next(): Promise<Response>;
};

export function createAdminAuthMiddleware(
  state: AdminState,
  adminPath: string,
): (ctx: FreshMiddlewareContext) => Promise<Response> {
  return async (ctx) => {
    const url = new URL(ctx.req.url);
    const path = url.pathname;

    if (path === `${adminPath}/login`) {
      return await ctx.next();
    }

    const credential = getCredentialFromRequest(ctx.req);
    if (!credential || credential.token !== state.config.admin?.auth_token) {
      if (path.startsWith(`${adminPath}/api/`)) {
        return json({ error: 'unauthorized' }, 401);
      }
      return redirectToLogin(ctx.req, adminPath);
    }

    if (
      needsCookieCsrfCheck(ctx.req, credential) &&
      !isSameOriginRequest(ctx.req, state.config.admin?.trust_proxy === true)
    ) {
      return path.startsWith(`${adminPath}/api/`)
        ? json({ error: 'csrf validation failed' }, 403)
        : new Response('Forbidden', { status: 403 });
    }

    return await ctx.next();
  };
}
```

- [ ] **Step 5: `admin/http/login_routes.ts` を作る**

```ts
import { h } from 'preact';
import type { AdminState } from '$admin/server.ts';
import type { AdminRouteApp } from '../route_types.ts';
import { LoginPage } from '../routes/login.tsx';
import { buildAdminCookie, clearAdminCookie, getSafeLoginNext } from '../security.ts';

export function registerAdminLoginRoutes(
  app: AdminRouteApp,
  adminPath: string,
  state: AdminState,
): void {
  app.get(`${adminPath}/login`, (ctx) => {
    return ctx.render(h(LoginPage as any, {}));
  });

  app.post(`${adminPath}/login`, async (ctx) => {
    const form = await ctx.req.formData();
    const token = form.get('token');
    if (typeof token === 'string' && token === state.config.admin?.auth_token) {
      const next = new URL(ctx.req.url).searchParams.get('next');
      const safeNext = getSafeLoginNext(next, adminPath);
      return new Response(null, {
        status: 302,
        headers: {
          Location: safeNext,
          'Set-Cookie': buildAdminCookie(token, adminPath),
        },
      });
    }
    return ctx.render(h(LoginPage as any, { error: 'Invalid token' }));
  });

  app.get(`${adminPath}/logout`, (_ctx) => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${adminPath}/login`,
        'Set-Cookie': clearAdminCookie(adminPath),
      },
    });
  });
}
```

- [ ] **Step 6: `admin/app/create_admin_app.ts` を配線だけに寄せる**

Remove direct imports of `json`, `LoginPage`, `security.ts` helpers, and `createStaticFileServer`. Add:

```ts
import { createAdminAuthMiddleware } from '../http/auth_middleware.ts';
import { registerAdminLoginRoutes } from '../http/login_routes.ts';
import { createAdminStaticMiddleware } from '../http/static_middleware.ts';
```

Replace inline static middleware with:

```ts
app.use(createAdminStaticMiddleware(STATIC_DIR, adminPath));
```

Replace inline auth middleware with:

```ts
app.use(createAdminAuthMiddleware(state, adminPath));
```

Replace inline login/logout routes with:

```ts
registerAdminLoginRoutes(app, adminPath, state);
```

- [ ] **Step 7: Task 2 verification を実行する**

```bash
deno fmt --check --config deno.json admin/app/create_admin_app.ts admin/http/json.ts admin/http/static_middleware.ts admin/http/auth_middleware.ts admin/http/login_routes.ts admin/main.test.ts
deno check admin/app/create_admin_app.ts admin/http/json.ts admin/http/static_middleware.ts admin/http/auth_middleware.ts admin/http/login_routes.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/security.test.ts admin/static_files.test.ts src/admin/main_csrf.test.ts
```

Expected: all commands exit `0`.

- [ ] **Step 8: Task 2 commit**

```bash
git add admin/app/create_admin_app.ts admin/http/json.ts admin/http/static_middleware.ts admin/http/auth_middleware.ts admin/http/login_routes.ts admin/main.test.ts
git commit -m "refactor: split admin HTTP shell"
```

## Task 3: Page Registration を `admin/pages` に分離する

**Files:**

- Create: `admin/pages/page_routes.ts`
- Create: `admin/pages/renderers.tsx`
- Modify: `admin/page_routes.ts`
- Modify: `admin/app/create_admin_app.ts`
- Test: `admin/page_routes.test.ts`
- Test: `admin/main.test.ts`

- [ ] **Step 1: red test を追加する**

`admin/page_routes.test.ts` に wrapper identity を固定する test を追加する。

```ts
Deno.test('admin page route compatibility module delegates to pages module', async () => {
  const compat = await import('./page_routes.ts');
  const pages = await import('./pages/page_routes.ts');

  assertEquals(compat.registerAdminPageRoutes, pages.registerAdminPageRoutes);
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/page_routes.test.ts
```

Expected: FAIL because `admin/pages/page_routes.ts` does not exist.

- [ ] **Step 2: `admin/pages/page_routes.ts` を作る**

Move the current implementation from `admin/page_routes.ts` into `admin/pages/page_routes.ts`. Use imports relative to the new directory:

```ts
import type { AdminRouteApp, AdminRouteContext, AdminRouteHandler } from '../route_types.ts';
```

Keep `AdminPageRenderers`, `PAGE_ROUTES`, and `registerAdminPageRoutes()` behavior unchanged.

- [ ] **Step 3: `admin/page_routes.ts` を wrapper にする**

```ts
export type { AdminPageRenderers } from './pages/page_routes.ts';
export { registerAdminPageRoutes } from './pages/page_routes.ts';
```

- [ ] **Step 4: `admin/pages/renderers.tsx` を作る**

```tsx
import { h } from 'preact';
import type { AdminState } from '$admin/server.ts';
import { BlocklistPage } from '../routes/blocklist.tsx';
import { ConfigPage } from '../routes/config.tsx';
import { ConnectionsPage } from '../routes/connections.tsx';
import { DashboardPage } from '../routes/index.tsx';
import { LogsPage } from '../routes/logs.tsx';
import { MetricsPage } from '../routes/metrics.tsx';
import { PipelinesPage } from '../routes/pipelines.tsx';
import { buildDashboardHealth } from '../app/dashboard_model.ts';
import type { AdminPageRenderers } from './page_routes.ts';

function currentPath(req: Request): string {
  return new URL(req.url).pathname;
}

export function buildAdminPageRenderers(state: AdminState): AdminPageRenderers {
  return {
    dashboard: (ctx) =>
      ctx.render(
        h(DashboardPage, {
          currentPath: currentPath(ctx.req),
          health: buildDashboardHealth(state),
        }),
      ),
    connections: (ctx) => ctx.render(h(ConnectionsPage, { currentPath: currentPath(ctx.req) })),
    pipelines: (ctx) =>
      ctx.render(
        h(PipelinesPage, {
          currentPath: currentPath(ctx.req),
          pipelines: state.config.pipelines,
          plugins: state.pluginNames,
        }),
      ),
    metrics: (ctx) => ctx.render(h(MetricsPage, { currentPath: currentPath(ctx.req) })),
    blocklist: (ctx) => ctx.render(h(BlocklistPage, { currentPath: currentPath(ctx.req) })),
    config: (ctx) => ctx.render(h(ConfigPage, { currentPath: currentPath(ctx.req) })),
    logs: (ctx) => ctx.render(h(LogsPage, { currentPath: currentPath(ctx.req) })),
  };
}
```

- [ ] **Step 5: `admin/app/create_admin_app.ts` の page imports を整理する**

Remove direct page component imports and `currentPath()` helper. Add:

```ts
import { registerAdminPageRoutes } from '../pages/page_routes.ts';
import { buildAdminPageRenderers } from '../pages/renderers.tsx';
```

Replace the inline renderer object with:

```ts
registerAdminPageRoutes(app, adminPath, buildAdminPageRenderers(state));
```

- [ ] **Step 6: Task 3 verification を実行する**

```bash
deno fmt --check --config deno.json admin/pages/page_routes.ts admin/pages/renderers.tsx admin/page_routes.ts admin/app/create_admin_app.ts admin/page_routes.test.ts
deno check admin/pages/page_routes.ts admin/pages/renderers.tsx admin/page_routes.ts admin/app/create_admin_app.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/page_routes.test.ts admin/main.test.ts
```

Expected: all commands exit `0`.

- [ ] **Step 7: Task 3 commit**

```bash
git add admin/pages/page_routes.ts admin/pages/renderers.tsx admin/page_routes.ts admin/app/create_admin_app.ts admin/page_routes.test.ts
git commit -m "refactor: split admin page registration"
```

## Task 4: Read Models と Logs HTTP Helper を分離する

**Files:**

- Create: `src/admin/read_models/health.ts`
- Create: `src/admin/read_models/config_view.ts`
- Create: `src/admin/read_models/connections.ts`
- Create: `src/admin/read_models/logs.ts`
- Create: `src/admin/read_models/throughput.ts`
- Create: `src/admin/http/log_stream.ts`
- Modify: `src/admin/health.ts`
- Modify: `src/admin/config_view.ts`
- Modify: `src/admin/connections.ts`
- Modify: `src/admin/logs.ts`
- Modify: `src/admin/throughput.ts`
- Test: `src/admin/connections.test.ts`
- Test: `src/admin/logs.test.ts`
- Test: `src/admin/service.test.ts`
- Test: `src/admin/server.test.ts`

- [ ] **Step 1: red tests を追加する**

`src/admin/connections.test.ts` に read model module gate を追加する。

```ts
Deno.test('admin connection read model lives outside the compatibility facade', async () => {
  const readModel = await import('./read_models/connections.ts');
  assertEquals(typeof readModel.getConnections, 'function');
  assertEquals(typeof readModel.closeConnectionBatch, 'undefined');
});
```

`src/admin/logs.test.ts` に logs boundary gate を追加する。

```ts
Deno.test('admin logs read model does not create HTTP responses', async () => {
  const readModel = await import('./read_models/logs.ts');
  const http = await import('./http/log_stream.ts');

  assertEquals(typeof readModel.getLogs, 'function');
  assertEquals(typeof readModel.createLogStreamResponse, 'undefined');
  assertEquals(typeof http.createLogStreamResponse, 'function');
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/connections.test.ts src/admin/logs.test.ts
```

Expected: FAIL because `src/admin/read_models/*` and `src/admin/http/log_stream.ts` do not exist.

- [ ] **Step 2: read model files を作る**

Create files by moving read-only code:

`src/admin/read_models/config_view.ts`:

```ts
import type { PfortnerConfig } from '../../config/loader.ts';

type MaskableConfig = {
  admin?: { auth_token?: string };
  infra?: { redis?: { url?: string } };
};

export function maskSecrets(config: PfortnerConfig): unknown {
  const masked = JSON.parse(JSON.stringify(config)) as MaskableConfig;
  if (masked.admin?.auth_token) masked.admin.auth_token = '***';
  if (masked.infra?.redis?.url) masked.infra.redis.url = '***';
  return masked;
}
```

`src/admin/read_models/throughput.ts`:

```ts
import type { AdminServiceState } from '../state.ts';

export function getThroughputData(state: AdminServiceState): unknown {
  return state.throughputTracker?.getData() ?? [];
}
```

`src/admin/read_models/connections.ts` contains `AdminConnectionDto`, `toAdminConnectionDto()`, and `getConnections()` from current `src/admin/connections.ts`, with imports changed to:

```ts
import type { ManagedConnection } from '../../connections/types.ts';
import type { AdminServiceState } from '../state.ts';
```

`src/admin/read_models/logs.ts` contains `LogsResult`, `parseLogLimit()`, and `getLogs()` from current `src/admin/logs.ts`, with imports changed to:

```ts
import type { LogEntry } from '../../infra/log-buffer.ts';
import type { AdminServiceState } from '../state.ts';
```

`src/admin/read_models/health.ts` contains `getHealthSimple()` and `getHealthDetail()` from current `src/admin/health.ts`, with imports changed to:

```ts
import type { AdminServiceState } from '../state.ts';
```

- [ ] **Step 3: `src/admin/http/log_stream.ts` を作る**

Move `createLogStreamResponse()` from current `src/admin/logs.ts` into `src/admin/http/log_stream.ts`. Use:

```ts
import type { AdminServiceState } from '../state.ts';
import { parseLogLimit } from '../read_models/logs.ts';
```

Keep the current `Response`, SSE headers, heartbeat, replay, subscribe, abort, and cleanup behavior unchanged.

- [ ] **Step 4: top-level read model files を wrapper にする**

`src/admin/config_view.ts`:

```ts
export { maskSecrets } from './read_models/config_view.ts';
```

`src/admin/throughput.ts`:

```ts
export { getThroughputData } from './read_models/throughput.ts';
```

`src/admin/health.ts`:

```ts
export { getHealthDetail, getHealthSimple } from './read_models/health.ts';
```

`src/admin/logs.ts`:

```ts
export type { LogsResult } from './read_models/logs.ts';
export { getLogs, parseLogLimit } from './read_models/logs.ts';
export { createLogStreamResponse } from './http/log_stream.ts';
```

`src/admin/connections.ts` keeps `closeConnection()` and `closeConnectionBatch()` for Task 5, but re-exports read model pieces:

```ts
import type { AdminServiceState } from './state.ts';

export type { AdminConnectionDto } from './read_models/connections.ts';
export { getConnections, toAdminConnectionDto } from './read_models/connections.ts';

export function closeConnection(state: AdminServiceState, id: string): { found: boolean } {
  const managed = state.connections.get(id);
  if (managed) {
    managed.close();
    return { found: true };
  }
  return { found: false };
}

export function closeConnectionBatch(
  state: AdminServiceState,
  ids: string[],
): { closed: string[]; notFound: string[] } {
  const closed: string[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    const managed = state.connections.get(id);
    if (managed) {
      managed.close();
      closed.push(id);
    } else {
      notFound.push(id);
    }
  }
  return { closed, notFound };
}
```

- [ ] **Step 5: Task 4 verification を実行する**

```bash
deno fmt --check --config deno.json src/admin/read_models/health.ts src/admin/read_models/config_view.ts src/admin/read_models/connections.ts src/admin/read_models/logs.ts src/admin/read_models/throughput.ts src/admin/http/log_stream.ts src/admin/health.ts src/admin/config_view.ts src/admin/connections.ts src/admin/logs.ts src/admin/throughput.ts src/admin/connections.test.ts src/admin/logs.test.ts
deno check src/admin/read_models/health.ts src/admin/read_models/config_view.ts src/admin/read_models/connections.ts src/admin/read_models/logs.ts src/admin/read_models/throughput.ts src/admin/http/log_stream.ts src/admin/health.ts src/admin/config_view.ts src/admin/connections.ts src/admin/logs.ts src/admin/throughput.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/connections.test.ts src/admin/logs.test.ts src/admin/service.test.ts src/admin/server.test.ts
```

Expected: all commands exit `0`.

- [ ] **Step 6: Task 4 commit**

```bash
git add src/admin/read_models/health.ts src/admin/read_models/config_view.ts src/admin/read_models/connections.ts src/admin/read_models/logs.ts src/admin/read_models/throughput.ts src/admin/http/log_stream.ts src/admin/health.ts src/admin/config_view.ts src/admin/connections.ts src/admin/logs.ts src/admin/throughput.ts src/admin/connections.test.ts src/admin/logs.test.ts
git commit -m "refactor: split admin read models"
```

## Task 5: Admin Actions と Fresh API Adapter を分離する

**Files:**

- Create: `src/admin/actions/blocklist.ts`
- Create: `src/admin/actions/connections.ts`
- Create: `src/admin/actions/pipeline_draft.ts`
- Create: `src/admin/actions/pipelines.ts`
- Create: `src/admin/actions/playground.ts`
- Create: `src/admin/actions/reload.ts`
- Create: `src/admin/actions/shutdown.ts`
- Create: `admin/http/api_routes.ts`
- Modify: `admin/api_routes.ts`
- Modify: `src/admin/connections.ts`
- Modify: `src/admin/pipeline_draft.ts`
- Modify: `src/admin/pipeline_simulator.ts`
- Test: `admin/api_routes.test.ts`
- Test: `src/admin/connections.test.ts`
- Test: `src/admin/pipeline_simulator.test.ts`
- Test: `src/admin/service.test.ts`

- [ ] **Step 1: red tests を追加する**

`admin/api_routes.test.ts` に Fresh route wrapper gate を追加する。

```ts
Deno.test('admin API route compatibility module delegates to HTTP module', async () => {
  const compat = await import('./api_routes.ts');
  const http = await import('./http/api_routes.ts');

  assertEquals(compat.registerAdminApiRoutes, http.registerAdminApiRoutes);
});
```

`src/admin/connections.test.ts` に action module gate を追加する。

```ts
Deno.test('admin connection actions live outside the compatibility facade', async () => {
  const actions = await import('./actions/connections.ts');
  assertEquals(typeof actions.closeConnectionBatch, 'function');
});
```

`src/admin/pipeline_simulator.test.ts` に wrapper gate を追加する。

```ts
Deno.test('admin pipeline simulator facade delegates to playground action module', async () => {
  const facade = await import('./pipeline_simulator.ts');
  const action = await import('./actions/playground.ts');
  assertEquals(facade.simulatePipeline, action.simulatePipeline);
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/api_routes.test.ts src/admin/connections.test.ts src/admin/pipeline_simulator.test.ts
```

Expected: FAIL because `admin/http/api_routes.ts` and `src/admin/actions/*` do not exist.

- [ ] **Step 2: `src/admin/actions/connections.ts` を作る**

Move `closeConnection()` and `closeConnectionBatch()` from `src/admin/connections.ts` into `src/admin/actions/connections.ts`:

```ts
import type { AdminServiceState } from '../state.ts';

export function closeConnection(state: AdminServiceState, id: string): { found: boolean } {
  const managed = state.connections.get(id);
  if (managed) {
    managed.close();
    return { found: true };
  }
  return { found: false };
}

export function closeConnectionBatch(
  state: AdminServiceState,
  ids: string[],
): { closed: string[]; notFound: string[] } {
  const closed: string[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    const managed = state.connections.get(id);
    if (managed) {
      managed.close();
      closed.push(id);
    } else {
      notFound.push(id);
    }
  }
  return { closed, notFound };
}
```

Then update `src/admin/connections.ts`:

```ts
export type { AdminConnectionDto } from './read_models/connections.ts';
export { getConnections, toAdminConnectionDto } from './read_models/connections.ts';
export { closeConnection, closeConnectionBatch } from './actions/connections.ts';
```

- [ ] **Step 3: `src/admin/actions/pipeline_draft.ts` を作る**

Move all current code from `src/admin/pipeline_draft.ts` into `src/admin/actions/pipeline_draft.ts`. Keep exported names:

- `PipelineWorkbenchDraft`
- `pipelineDraftPathForConfig`
- `normalizePipelineWorkbenchDraft`
- `readPipelineWorkbenchDraft`
- `writePipelineWorkbenchDraft`

Replace `src/admin/pipeline_draft.ts` with:

```ts
export type { PipelineWorkbenchDraft } from './actions/pipeline_draft.ts';
export {
  normalizePipelineWorkbenchDraft,
  pipelineDraftPathForConfig,
  readPipelineWorkbenchDraft,
  writePipelineWorkbenchDraft,
} from './actions/pipeline_draft.ts';
```

- [ ] **Step 4: `src/admin/actions/playground.ts` を作る**

Move all current code from `src/admin/pipeline_simulator.ts` into `src/admin/actions/playground.ts`. Keep exported names:

- `SimulateStep`
- `SimulateResult`
- `simulatePipeline`

Add request normalization helpers currently embedded in `admin/api_routes.ts`:

```ts
import type { PfortnerConfig, PipelineEntry } from '../../config/loader.ts';

type PlaygroundConnectionInfo = {
  clientAuthorized: boolean;
  clientPubkey: string;
  connectionIpAddr: string;
};

export type PlaygroundEvaluateInput = {
  message: unknown;
  direction?: unknown;
  pipeline?: unknown;
  connectionInfo?: unknown;
};

export type PlaygroundEvaluateResult =
  | { result: SimulateResult }
  | { error: string; status: number };
```

Implement `evaluatePlaygroundRequest(config: PfortnerConfig, input: PlaygroundEvaluateInput): Promise<PlaygroundEvaluateResult>` by moving the body parsing logic from `admin/api_routes.ts`. It must:

- return `{ error: 'request body object required', status: 400 }` when input is not a record;
- return `{ error: 'message must be an array', status: 400 }` when `message` is not an array;
- normalize optional posted `pipeline` with `normalizePipelineEntries(body.pipeline, 'pipeline')`;
- choose `config.pipelines.server` when `direction === 'server'`, otherwise `config.pipelines.client`;
- call `simulatePipeline()` and return `{ result }`.

Replace `src/admin/pipeline_simulator.ts` with:

```ts
export type { SimulateResult, SimulateStep } from './actions/playground.ts';
export { simulatePipeline } from './actions/playground.ts';
```

- [ ] **Step 5: `src/admin/actions/pipelines.ts` を作る**

Move YAML and pipeline normalize helpers from `admin/api_routes.ts` into `src/admin/actions/pipelines.ts`.

Exports:

```ts
import { parse as parseYaml, stringify as stringifyYaml } from '@std/yaml';
import type { PfortnerConfig, PipelineEntry } from '../../config/loader.ts';

export type PipelineSet = PfortnerConfig['pipelines'];

export type SavePipelinesResult =
  | { status: 'saved'; pipelines: PipelineSet }
  | { error: string; status: number };

export function normalizePipelineEntries(
  value: unknown,
  path: string,
): { entries: PipelineEntry[] } | { error: string };

export function normalizePipelines(
  value: unknown,
): { pipelines: PipelineSet } | { error: string };

export function stringifyConfigWithPipelines(
  currentYaml: string,
  pipelines: PipelineSet,
): string;
```

Implement `savePipelinesToConfig(state, pipelinesInput)`:

```ts
export async function savePipelinesToConfig(
  state: {
    config: PfortnerConfig;
    configPath?: string;
    reloadFn?: (yamlString: string) => Promise<void>;
  },
  pipelinesInput: unknown,
): Promise<SavePipelinesResult> {
  if (!state.configPath || !state.reloadFn) {
    return { error: 'pipeline save not configured', status: 500 };
  }
  const normalized = normalizePipelines(pipelinesInput);
  if ('error' in normalized) {
    return { error: normalized.error, status: 400 };
  }
  try {
    const currentYaml = await Deno.readTextFile(state.configPath);
    const yaml = stringifyConfigWithPipelines(currentYaml, normalized.pipelines);
    await state.reloadFn(yaml);
    await Deno.writeTextFile(state.configPath, yaml);
    return {
      status: 'saved',
      pipelines: state.config.pipelines ?? normalized.pipelines,
    };
  } catch (e) {
    return { error: `pipeline save failed: ${(e as Error).message}`, status: 500 };
  }
}
```

- [ ] **Step 6: blocklist/reload/shutdown action files を作る**

`src/admin/actions/blocklist.ts`:

```ts
export type RuntimeBlocklist = { pubkeys: Set<string>; ips: Set<string> };

export function listBlocklist(blocklist: RuntimeBlocklist): { pubkeys: string[]; ips: string[] } {
  return { pubkeys: [...blocklist.pubkeys], ips: [...blocklist.ips] };
}

export function addPubkey(blocklist: RuntimeBlocklist, pubkey: unknown): { added: string } | { error: string } {
  if (typeof pubkey === 'string' && pubkey.length > 0) {
    blocklist.pubkeys.add(pubkey);
    return { added: pubkey };
  }
  return { error: 'pubkey required' };
}

export function deletePubkey(blocklist: RuntimeBlocklist, pubkey: string): { deleted: string } | { error: string } {
  if (pubkey) {
    blocklist.pubkeys.delete(pubkey);
    return { deleted: pubkey };
  }
  return { error: 'pubkey required' };
}

export function addIp(blocklist: RuntimeBlocklist, ip: unknown): { added: string } | { error: string } {
  if (typeof ip === 'string' && ip.length > 0) {
    blocklist.ips.add(ip);
    return { added: ip };
  }
  return { error: 'ip required' };
}

export function deleteIp(blocklist: RuntimeBlocklist, ip: string): { deleted: string } | { error: string } {
  if (ip) {
    blocklist.ips.delete(ip);
    return { deleted: ip };
  }
  return { error: 'ip required' };
}
```

`src/admin/actions/reload.ts`:

```ts
export async function reloadConfig(state: {
  configPath?: string;
  reloadFn?: (yamlString: string) => Promise<void>;
}): Promise<{ status: 'reloaded' } | { error: string; status: number }> {
  if (!state.configPath || !state.reloadFn) {
    return { error: 'reload not configured', status: 500 };
  }
  try {
    const content = await Deno.readTextFile(state.configPath);
    await state.reloadFn(content);
    return { status: 'reloaded' };
  } catch (e) {
    return { error: `reload failed: ${(e as Error).message}`, status: 500 };
  }
}
```

`src/admin/actions/shutdown.ts`:

```ts
export function shutdownAdmin(state: {
  shutdownManager?: { initiateShutdown(): Promise<void> };
}): { status: 'shutting down' } | { error: string; status: number } {
  if (state.shutdownManager) {
    state.shutdownManager.initiateShutdown().catch(console.error);
    return { status: 'shutting down' };
  }
  return { error: 'shutdown not configured', status: 500 };
}
```

- [ ] **Step 7: `admin/http/api_routes.ts` を作る**

Move `registerAdminApiRoutes()` from `admin/api_routes.ts` into `admin/http/api_routes.ts`. Use `../route_types.ts`, `./json.ts`, read models from `$admin/service.ts`, and action modules from `$admin/actions/*`.

Important response mappings:

- pipeline draft read/write uses `readPipelineWorkbenchDraft()`, `normalizePipelineWorkbenchDraft()`, `writePipelineWorkbenchDraft()`;
- pipeline save calls `savePipelinesToConfig()` and returns `json({ error }, status)` or `json({ status: 'saved', pipelines })`;
- playground evaluate calls `evaluatePlaygroundRequest(state.config, body)` and returns `json(error, status)` or `json(result)`;
- blocklist uses action functions and preserves existing error strings/status codes;
- reload success remains `302 Location: /admin/`;
- shutdown success remains `302 Location: /admin/`;
- logs stream calls `createLogStreamResponse()` from `$admin/http/log_stream.ts`.

- [ ] **Step 8: `admin/api_routes.ts` を wrapper にする**

```ts
export { registerAdminApiRoutes } from './http/api_routes.ts';
```

- [ ] **Step 9: Task 5 verification を実行する**

```bash
deno fmt --check --config deno.json admin/http/api_routes.ts admin/api_routes.ts src/admin/actions/blocklist.ts src/admin/actions/connections.ts src/admin/actions/pipeline_draft.ts src/admin/actions/pipelines.ts src/admin/actions/playground.ts src/admin/actions/reload.ts src/admin/actions/shutdown.ts src/admin/connections.ts src/admin/pipeline_draft.ts src/admin/pipeline_simulator.ts admin/api_routes.test.ts src/admin/connections.test.ts src/admin/pipeline_simulator.test.ts
deno check admin/http/api_routes.ts admin/api_routes.ts src/admin/actions/blocklist.ts src/admin/actions/connections.ts src/admin/actions/pipeline_draft.ts src/admin/actions/pipelines.ts src/admin/actions/playground.ts src/admin/actions/reload.ts src/admin/actions/shutdown.ts src/admin/connections.ts src/admin/pipeline_draft.ts src/admin/pipeline_simulator.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/api_routes.test.ts src/admin/connections.test.ts src/admin/pipeline_simulator.test.ts src/admin/service.test.ts
```

Expected: all commands exit `0`.

- [ ] **Step 10: Task 5 commit**

```bash
git add admin/http/api_routes.ts admin/api_routes.ts src/admin/actions/blocklist.ts src/admin/actions/connections.ts src/admin/actions/pipeline_draft.ts src/admin/actions/pipelines.ts src/admin/actions/playground.ts src/admin/actions/reload.ts src/admin/actions/shutdown.ts src/admin/connections.ts src/admin/pipeline_draft.ts src/admin/pipeline_simulator.ts admin/api_routes.test.ts src/admin/connections.test.ts src/admin/pipeline_simulator.test.ts
git commit -m "refactor: split admin API actions"
```

## Task 6: Bearer API を共通 Action/Read Model に寄せる

**Files:**

- Modify: `src/admin/server.ts`
- Test: `src/admin/server.test.ts`
- Test: `src/admin/main_csrf.test.ts`

- [ ] **Step 1: red regression tests を追加する**

`src/admin/server.test.ts` に Fresh-only endpoint が Bearer API に増えていないことを固定する。

```ts
Deno.test('Bearer admin API does not expose Fresh-only pipeline endpoints', async () => {
  const handler = createAdminHandler(makeState());

  const pipelineDraft = await handler(makeRequest('/pipeline-draft'));
  const pipelines = await handler(makeRequest('/pipelines', 'POST', 'test-token', JSON.stringify({ pipelines: {} })));
  const playground = await handler(
    makeRequest('/playground/evaluate', 'POST', 'test-token', JSON.stringify({ message: [] })),
  );

  assertEquals(pipelineDraft.status, 404);
  assertEquals(pipelines.status, 404);
  assertEquals(playground.status, 404);
});
```

Add a Bearer health payload shape test:

```ts
Deno.test('Bearer admin health keeps summary payload shape', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/health'));
  const body = await res.json();

  assertEquals(Object.keys(body).sort(), ['connections', 'pressure', 'status']);
});
```

Run:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/server.test.ts
```

Expected: If current behavior already matches, PASS. Keep the tests because they are regression gates for the refactor.

- [ ] **Step 2: `src/admin/server.ts` imports を共通 module に寄せる**

Replace service imports with direct imports:

```ts
import { closeConnection, closeConnectionBatch } from './actions/connections.ts';
import { addIp, addPubkey, deleteIp, deletePubkey } from './actions/blocklist.ts';
import { reloadConfig } from './actions/reload.ts';
import { shutdownAdmin } from './actions/shutdown.ts';
import { maskSecrets } from './read_models/config_view.ts';
import { getConnections } from './read_models/connections.ts';
import { getHealthDetail, getHealthSimple } from './read_models/health.ts';
import { getLogs, parseLogLimit } from './read_models/logs.ts';
import { getThroughputData } from './read_models/throughput.ts';
import { createLogStreamResponse } from './http/log_stream.ts';
```

Keep `json()` and `AdminState` exports in `src/admin/server.ts`.

- [ ] **Step 3: Bearer health projection を維持する**

Keep `/health` response exactly:

```ts
const health = getHealthSimple(state);
const stats = state.connectionManager?.getStats();
return json({
  status: health.status,
  connections: stats?.active ?? state.connections.size,
  pressure: stats?.pressure ?? 'normal',
});
```

Keep `/health/detail` response shape exactly:

```ts
const stats = state.connectionManager?.getStats() ?? {
  active: state.connections.size,
  authenticated: 0,
  max: 0,
  perIpMax: 0,
  pressure: 'normal' as const,
};
const uptime = state.startTime != null ? Math.floor((Date.now() - state.startTime) / 1000) : null;
return json({
  status: getHealthDetail(state).status,
  uptime_seconds: uptime,
  connections: stats,
  upstream: {
    status: state.upstreamProbe?.getStatus() ?? 'unknown',
    latency_ms: state.upstreamProbe?.getLatency() ?? null,
  },
  memory: Deno.memoryUsage(),
});
```

- [ ] **Step 4: Bearer actions を置き換える**

For blocklist routes, use action return values:

```ts
const result = addPubkey(state.blocklist, body.pubkey);
return 'error' in result ? json({ error: result.error }, 400) : json(result);
```

Use the same pattern for `deletePubkey`, `addIp`, and `deleteIp`.

For reload:

```ts
const result = await reloadConfig(state);
return 'error' in result ? json({ error: result.error }, result.status) : json(result);
```

For shutdown:

```ts
const result = shutdownAdmin(state);
return 'error' in result ? json({ error: result.error }, result.status) : json(result);
```

Do not add routes for `pipeline-draft`, `pipelines`, `playground`, Prometheus text export, or blocklist list.

- [ ] **Step 5: Task 6 verification を実行する**

```bash
deno fmt --check --config deno.json src/admin/server.ts src/admin/server.test.ts
deno check src/admin/server.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv src/admin/server.test.ts src/admin/main_csrf.test.ts
```

Expected: all commands exit `0`.

- [ ] **Step 6: Task 6 commit**

```bash
git add src/admin/server.ts src/admin/server.test.ts
git commit -m "refactor: share admin bearer actions"
```

## Task 7: Docs と Import Boundary を固定する

**Files:**

- Create: `admin/import_boundary.test.ts`
- Modify: `docs/current-architecture.md`
- Modify: `CLAUDE.md`
- Test: `admin/import_boundary.test.ts`
- Test: full targeted command set

- [ ] **Step 1: import-boundary test を作る**

Create `admin/import_boundary.test.ts`:

```ts
import { assertEquals } from '@std/assert';

const ADMIN_SOURCE_ROOT = new URL('./', import.meta.url);

async function collectSourceFiles(dir: URL): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const entryUrl = new URL(entry.name, dir);
    if (entry.isDirectory) {
      if (entry.name === 'static') continue;
      files.push(...await collectSourceFiles(new URL(`${entry.name}/`, dir)));
    } else if (entry.isFile && /\.(ts|tsx|js)$/.test(entry.name)) {
      files.push(entryUrl.pathname);
    }
  }
  return files;
}

Deno.test('admin source modules do not import implementation from admin/static', async () => {
  const files = await collectSourceFiles(ADMIN_SOURCE_ROOT);
  const offenders: string[] = [];

  for (const file of files) {
    const source = await Deno.readTextFile(file);
    if (source.includes('../static/') || source.includes('../../static/') || source.includes('./static/')) {
      offenders.push(file.replace(ADMIN_SOURCE_ROOT.pathname, 'admin/'));
    }
  }

  assertEquals(offenders, []);
});
```

Run:

```bash
deno test --allow-read admin/import_boundary.test.ts
```

Expected: PASS. If it fails, inspect the offender and remove the static implementation import.

- [ ] **Step 2: `docs/current-architecture.md` を更新する**

Admin Server/Admin Services/Admin UI sections を更新し、次の内容を記録する。

- `admin/main.ts` は compatibility entrypoint。
- `admin/app/*` は Fresh app composition。
- `admin/http/*` は HTTP adapter/middleware。
- `admin/pages/*` は page registration。
- `src/admin/read_models/*` は read-only snapshots。
- `src/admin/actions/*` は mutation/domain action modules。
- `src/admin/http/log_stream.ts` は shared SSE response helper。
- top-level `src/admin/*.ts` service files は compatibility facades。

generated `admin/static/fresh_nav.js` と `admin/static/islands/PipelineWorkbench.js` に関する既存の履歴説明は残す。

- [ ] **Step 3: `CLAUDE.md` を更新する**

古い Admin UI architecture paragraph を、次の current structure に置き換える。

- Fresh 2.x + Preact が `/admin` を serve する。
- `admin/main.ts` は `admin/app/create_admin_app.ts` に delegate する。
- `admin/http/*` が HTTP adapters を担う。
- `admin/pages/*` が authenticated page route registration を担う。
- source client logic は `admin/client/*` と `admin/islands/*` に残る。
- `admin/static/*` は URL-addressed output または static asset に限定する。
- `src/admin/read_models/*`、`src/admin/actions/*`、`src/admin/http/log_stream.ts`、top-level facades が admin service boundaries を定義する。

- [ ] **Step 4: final verification を実行する**

```bash
deno fmt --check --config deno.json
deno lint --config deno.json
deno check mod.ts admin/main.ts admin/api_routes.ts src/admin/server.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/main.test.ts admin/api_routes.test.ts admin/page_routes.test.ts admin/security.test.ts admin/static_files.test.ts admin/import_boundary.test.ts src/admin/main_csrf.test.ts src/admin/server.test.ts src/admin/service.test.ts src/admin/connections.test.ts src/admin/logs.test.ts src/admin/pipeline_simulator.test.ts
deno test --allow-env --allow-net --allow-read --allow-write --unstable-net --unstable-kv admin/ src/admin/
```

Expected: all commands exit `0`. If `deno task test` is run and fails with socket bind `PermissionDenied` or `Operation not permitted`, report it as environment bind restriction only after targeted tests above pass.

- [ ] **Step 5: Task 7 commit**

```bash
git add admin/import_boundary.test.ts docs/current-architecture.md CLAUDE.md
git commit -m "docs: record admin subsystem boundaries"
```

## Final Gate

- [ ] **Step 1: Review git history**

```bash
git log --oneline -8
```

Expected: commits for app composition, HTTP shell, page registration, read models, API actions, Bearer API, and docs/boundary are separate.

- [ ] **Step 2: Confirm no unintended staged files**

```bash
git status --short
git diff --cached --name-only
```

Expected: no staged files. Existing user dirty files may remain; do not revert them.

- [ ] **Step 3: Record final verification**

Paste the final command outputs into the implementation report:

- `deno fmt --check --config deno.json`
- `deno lint --config deno.json`
- `deno check mod.ts admin/main.ts admin/api_routes.ts src/admin/server.ts`
- targeted `deno test ...`

If a command is blocked by environment permissions, include the exact command, exit code, and first relevant error line.
