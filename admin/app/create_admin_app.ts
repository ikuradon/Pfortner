import { App } from '@fresh/core';
import { h } from 'preact';
import type { AdminState } from '$admin/server.ts';
import { BlocklistPage } from '../routes/blocklist.tsx';
import { ConfigPage } from '../routes/config.tsx';
import { ConnectionsPage } from '../routes/connections.tsx';
import { DashboardPage } from '../routes/index.tsx';
import { LogsPage } from '../routes/logs.tsx';
import { MetricsPage } from '../routes/metrics.tsx';
import { PipelinesPage } from '../routes/pipelines.tsx';
import { registerAdminApiRoutes } from '../api_routes.ts';
import { createAdminAuthMiddleware } from '../http/auth_middleware.ts';
import { registerAdminLoginRoutes } from '../http/login_routes.ts';
import { createAdminStaticMiddleware } from '../http/static_middleware.ts';
import { registerAdminPageRoutes } from '../page_routes.ts';
import { buildDashboardHealth } from './dashboard_model.ts';
import { withAdminFreshRuntime } from './fresh_runtime.ts';
import { installAdminIslandBuildCache } from './island_build_cache.ts';

const STATIC_DIR = new URL('../static', import.meta.url).pathname;

function currentPath(req: Request): string {
  return new URL(req.url).pathname;
}

/**
 * Creates and returns a Fresh-based admin UI handler.
 * The handler processes all requests for /admin/* paths.
 */
export function createAdminApp(
  state: AdminState,
): (req: Request) => Promise<Response> {
  const adminPath = '/admin';

  const app = new App({ root: STATIC_DIR } as Record<string, unknown> as any);
  installAdminIslandBuildCache(app as App<unknown>);

  app.use(createAdminStaticMiddleware(STATIC_DIR, adminPath));

  app.use(async (ctx) => {
    return await withAdminFreshRuntime(await ctx.next());
  });

  app.use(createAdminAuthMiddleware(state, adminPath));
  registerAdminLoginRoutes(app, adminPath, state);

  registerAdminPageRoutes(app, adminPath, {
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
  });
  registerAdminApiRoutes(app, adminPath, state);

  return app.handler();
}
