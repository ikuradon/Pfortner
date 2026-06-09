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
  };
}

Deno.test('page route registrar redirects root and registers SPA shell pages', async () => {
  const app = new RecordedRoutes();
  const rendered: string[] = [];

  registerAdminPageRoutes(app, '/admin', (pathname: string) => {
    rendered.push(pathname);
    return new Response(`shell:${pathname}`);
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

  const shell = await app.getRoutes.get('/admin/blocklist')!(makeContext('/admin/blocklist'));
  assertEquals(shell.status, 200);
  assertEquals(await shell.text(), 'shell:/admin/blocklist');
  assertEquals(rendered, ['/admin/blocklist']);
});
