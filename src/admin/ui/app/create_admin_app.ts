import { App } from '@fresh/core';
import type { AdminState } from '$admin/server.ts';
import { registerAdminApiRoutes } from '../http/api_routes.ts';
import { createAdminAuthMiddleware } from '../http/auth_middleware.ts';
import { registerAdminLoginRoutes } from '../http/login_routes.ts';
import { createAdminStaticMiddleware } from '../http/static_middleware.ts';
import { registerAdminPageRoutes } from '../pages/page_routes.ts';
import { buildAdminPageRenderers } from '../pages/renderers.tsx';
import { withAdminFreshRuntime } from './fresh_runtime.ts';
import { installAdminIslandBuildCache } from './island_build_cache.ts';

const STATIC_DIR = new URL('../static', import.meta.url).pathname;

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

  registerAdminPageRoutes(app, adminPath, buildAdminPageRenderers(state));
  registerAdminApiRoutes(app, adminPath, state);

  return app.handler();
}
