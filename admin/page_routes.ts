import type { AdminRouteApp } from './route_types.ts';

type RenderAdminShell = (pathname: string) => Response;

const SPA_PAGE_PATHS = [
  '/',
  '/connections',
  '/pipelines',
  '/metrics',
  '/blocklist',
  '/config',
  '/logs',
] as const;

export function registerAdminPageRoutes(
  app: AdminRouteApp,
  adminPath: string,
  renderAdminShell: RenderAdminShell,
): void {
  app.get(adminPath, (_ctx) => {
    return new Response(null, {
      status: 302,
      headers: { Location: `${adminPath}/` },
    });
  });

  for (const pagePath of SPA_PAGE_PATHS) {
    const routePath = pagePath === '/' ? `${adminPath}/` : `${adminPath}${pagePath}`;
    app.get(routePath, (ctx) => {
      const url = new URL(ctx.req.url);
      return renderAdminShell(url.pathname);
    });
  }
}
