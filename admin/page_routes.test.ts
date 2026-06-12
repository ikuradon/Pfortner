import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { registerAdminPageRoutes } from './page_routes.ts';
import type { AdminRouteApp, AdminRouteContext, AdminRouteHandler } from './route_types.ts';

class RecordedRoutes implements AdminRouteApp {
  readonly getRoutes = new Map<string, AdminRouteHandler>();
  readonly postRoutes = new Map<string, AdminRouteHandler>();
  readonly deleteRoutes = new Map<string, AdminRouteHandler>();

  get(path: string, handler: AdminRouteHandler): void {
    this.getRoutes.set(path, handler);
  }

  post(path: string, handler: AdminRouteHandler): void {
    this.postRoutes.set(path, handler);
  }

  delete(path: string, handler: AdminRouteHandler): void {
    this.deleteRoutes.set(path, handler);
  }
}

function makeContext(path: string): AdminRouteContext {
  return {
    req: new Request(`http://localhost:3000${path}`),
    params: {},
    render: () => Promise.resolve(new Response('rendered')),
  };
}

Deno.test('admin page route compatibility module delegates to pages module', async () => {
  const compat = await import('./page_routes.ts');
  const pages = await import('./pages/page_routes.ts');

  assertEquals(compat.registerAdminPageRoutes, pages.registerAdminPageRoutes);
});

Deno.test('page route registrar redirects root and renders registered Fresh pages', async () => {
  const app = new RecordedRoutes();
  const rendered: string[] = [];

  registerAdminPageRoutes(app, '/admin', {
    dashboard: (ctx) => {
      rendered.push(`dashboard:${new URL(ctx.req.url).pathname}`);
      return new Response('dashboard-page');
    },
    connections: () => new Response('connections-page'),
    pipelines: () => new Response('pipelines-page'),
    metrics: () => new Response('metrics-page'),
    blocklist: (ctx) => {
      rendered.push(`blocklist:${new URL(ctx.req.url).pathname}`);
      return new Response('blocklist-page');
    },
    config: () => new Response('config-page'),
    logs: () => new Response('logs-page'),
  });

  assertEquals(app.getRoutes.has('/admin'), true);
  assertEquals(app.getRoutes.has('/admin/'), true);
  assertEquals(app.getRoutes.has('/admin/connections'), true);
  assertEquals(app.getRoutes.has('/admin/blocklist'), true);
  assertEquals(app.getRoutes.has('/admin/logs'), true);
  assertEquals(app.getRoutes.has('/admin/playground'), false);

  const redirect = await app.getRoutes.get('/admin')!(makeContext('/admin'));
  assertEquals(redirect.status, 302);
  assertEquals(redirect.headers.get('Location'), '/admin/');

  const blocklist = await app.getRoutes.get('/admin/blocklist')!(makeContext('/admin/blocklist'));
  assertEquals(blocklist.status, 200);
  assertEquals(await blocklist.text(), 'blocklist-page');
  assertEquals(rendered, ['blocklist:/admin/blocklist']);
});
