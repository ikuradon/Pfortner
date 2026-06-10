import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createPageRoutes } from './page_templates.js';

Deno.test('admin SPA page templates expose all routed pages', () => {
  const routes = createPageRoutes() as
    & ReturnType<typeof createPageRoutes>
    & Record<string, unknown>;

  assertEquals(Object.keys(routes), [
    '/admin/',
    '/admin/connections',
    '/admin/pipelines',
    '/admin/metrics',
    '/admin/blocklist',
    '/admin/config',
    '/admin/logs',
  ]);
  assertEquals(routes['/admin/'].init, 'initDashboardPage');
  assertEquals(routes['/admin/pipelines'].module, '/admin/static/pipelines.js');
  assertEquals(routes['/admin/playground'], undefined);
  assertEquals(routes['/admin/blocklist'].module, '/admin/static/blocklist.js');
  assertEquals(typeof routes['/admin/logs'].render, 'function');
});

Deno.test('pipelines template exposes canvas-first modal workbench ids', () => {
  const source = String(createPageRoutes()['/admin/pipelines'].render);

  for (
    const id of [
      'btn-toggle-palette',
      'btn-undo-pipeline',
      'btn-redo-pipeline',
      'btn-save-dag',
      'btn-publish-pipeline',
      'node-settings-modal',
      'playground-modal',
    ]
  ) {
    assertEquals(
      source.includes(`id: '${id}'`) || source.includes(`id: "${id}"`),
      true,
    );
  }
  assertEquals(source.includes('node-inspector'), false);
  assertEquals(source.includes('test-run-drawer'), false);
});
