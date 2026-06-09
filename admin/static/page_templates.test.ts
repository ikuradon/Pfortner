import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createPageRoutes } from './page_templates.js';

Deno.test('admin SPA page templates expose all routed pages', () => {
  const routes = createPageRoutes();

  assertEquals(Object.keys(routes), [
    '/admin/',
    '/admin/connections',
    '/admin/pipelines',
    '/admin/playground',
    '/admin/metrics',
    '/admin/blocklist',
    '/admin/config',
    '/admin/logs',
  ]);
  assertEquals(routes['/admin/'].init, 'initDashboardPage');
  assertEquals(routes['/admin/blocklist'].module, '/admin/static/blocklist.js');
  assertEquals(typeof routes['/admin/logs'].render, 'function');
});
