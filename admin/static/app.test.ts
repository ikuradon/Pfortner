import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { versionStaticAssetPath } from './app.js';

Deno.test('admin SPA router appends asset version to page module imports', () => {
  assertEquals(
    versionStaticAssetPath('/admin/static/dashboard.js', 'cache-bust-1'),
    '/admin/static/dashboard.js?v=cache-bust-1',
  );
  assertEquals(
    versionStaticAssetPath('/admin/static/dashboard.js?existing=1', 'cache-bust-1'),
    '/admin/static/dashboard.js?existing=1&v=cache-bust-1',
  );
  assertEquals(
    versionStaticAssetPath('/admin/static/dashboard.js', ''),
    '/admin/static/dashboard.js',
  );
});
