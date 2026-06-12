import type { AdminRouteApp, AdminRouteContext, AdminRouteHandler } from '../route_types.ts';

export interface AdminPageRenderers {
  dashboard: AdminRouteHandler;
  connections: AdminRouteHandler;
  pipelines: AdminRouteHandler;
  metrics: AdminRouteHandler;
  blocklist: AdminRouteHandler;
  config: AdminRouteHandler;
  logs: AdminRouteHandler;
}

const PAGE_ROUTES: Array<[keyof AdminPageRenderers, string]> = [
  ['dashboard', '/'],
  ['connections', '/connections'],
  ['pipelines', '/pipelines'],
  ['metrics', '/metrics'],
  ['blocklist', '/blocklist'],
  ['config', '/config'],
  ['logs', '/logs'],
];

export function registerAdminPageRoutes(
  app: AdminRouteApp,
  adminPath: string,
  renderers: AdminPageRenderers,
): void {
  app.get(adminPath, (_ctx) => {
    return new Response(null, {
      status: 302,
      headers: { Location: `${adminPath}/` },
    });
  });

  for (const [key, pagePath] of PAGE_ROUTES) {
    const routePath = pagePath === '/' ? `${adminPath}/` : `${adminPath}${pagePath}`;
    app.get(routePath, (ctx: AdminRouteContext) => renderers[key](ctx));
  }
}
