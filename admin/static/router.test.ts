import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { normalizePath, versionStaticAssetPath } from './router.js';

Deno.test('admin SPA router normalizes admin paths', () => {
  assertEquals(normalizePath('/admin'), '/admin/');
  assertEquals(normalizePath('/admin/'), '/admin/');
  assertEquals(normalizePath('/admin/logs/'), '/admin/logs');
  assertEquals(normalizePath('/admin/logs'), '/admin/logs');
});

Deno.test('admin SPA router appends cache version to static assets', () => {
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
