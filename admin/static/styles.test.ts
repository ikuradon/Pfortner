import { assertMatch } from '@std/assert';

const css = await Deno.readTextFile(new URL('./styles.css', import.meta.url));

Deno.test('pipeline compact palette header centers toggle button in icon rail', () => {
  assertMatch(
    css,
    /\.palette-header\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
  );
  assertMatch(
    css,
    /\.btn-icon\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*height:\s*28px;[^}]*padding:\s*0;/s,
  );
  assertMatch(
    css,
    /\.pipeline-workbench\.palette-collapsed \.palette-header\s*\{[^}]*justify-content:\s*center;[^}]*padding:\s*6px;/s,
  );
  assertMatch(
    css,
    /@media \(max-width: 900px\)\s*\{[\s\S]*?\.canvas-first-grid \.palette-header\s*\{[^}]*justify-content:\s*center;[^}]*padding:\s*6px;/,
  );
});

Deno.test('sidebar collapsed state narrows nav and preserves explicit toggle', () => {
  assertMatch(
    css,
    /\[data-sidebar='collapsed'\] \.sidebar\s*\{[^}]*width:\s*64px;/s,
  );
  assertMatch(
    css,
    /\[data-sidebar='collapsed'\] \.main-content\s*\{[^}]*margin-left:\s*64px;/s,
  );
  assertMatch(
    css,
    /\.sidebar-toggle\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*height:\s*28px;/s,
  );
  assertMatch(
    css,
    /\[data-sidebar='collapsed'\] \.sidebar-logo-text,[\s\S]*?\[data-sidebar='collapsed'\] \.sidebar-nav-label,[\s\S]*?\[data-sidebar='collapsed'\] \.sidebar-footer \.text-muted\s*\{[^}]*display:\s*none;/s,
  );
});
