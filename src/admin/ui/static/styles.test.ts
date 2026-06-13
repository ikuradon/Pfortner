import { assertMatch, assertNotMatch } from '@std/assert';

const css = await Deno.readTextFile(new URL('./styles.css', import.meta.url));

Deno.test('pipeline compact palette header centers toggle button in icon rail', () => {
  assertMatch(
    css,
    /\.palette-header\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
  );
  assertMatch(
    css,
    /\.btn-icon\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*height:\s*28px;[^}]*padding:\s*0;[^}]*justify-content:\s*center;/s,
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

Deno.test('pipeline compact palette only hides labels and keeps policy icons visible', () => {
  assertNotMatch(
    css,
    /\.pipeline-workbench\.palette-collapsed \.workbench-panel-header span\s*,/s,
  );
  assertNotMatch(
    css,
    /\.canvas-first-grid \.workbench-panel-header span\s*,/s,
  );
  assertMatch(
    css,
    /\.pipeline-workbench\.palette-collapsed \.palette-header > span,[\s\S]*?\.pipeline-workbench\.palette-collapsed \.policy-palette-name,[\s\S]*?\.pipeline-workbench\.palette-collapsed \.policy-palette-add\s*\{[^}]*display:\s*none;/s,
  );
  assertMatch(
    css,
    /\.pipeline-workbench\.palette-collapsed \.policy-palette\s*\{[^}]*padding:\s*8px 5px;/s,
  );
  assertMatch(
    css,
    /\.pipeline-workbench\.palette-collapsed \.policy-palette-item\s*\{[^}]*grid-template-columns:\s*24px;[^}]*padding:\s*4px;/s,
  );
  assertMatch(
    css,
    /@media \(max-width: 900px\)\s*\{[\s\S]*?\.canvas-first-grid \.palette-header > span,[\s\S]*?\.canvas-first-grid \.policy-palette-name,[\s\S]*?\.canvas-first-grid \.policy-palette-add,[\s\S]*?\.canvas-first-grid #canvas-zoom-label\s*\{[^}]*display:\s*none;/s,
  );
  assertMatch(
    css,
    /@media \(max-width: 900px\)\s*\{[\s\S]*?\.canvas-first-grid \.policy-palette\s*\{[^}]*padding:\s*8px 5px;/s,
  );
  assertMatch(
    css,
    /@media \(max-width: 900px\)\s*\{[\s\S]*?\.canvas-first-grid \.policy-palette-item\s*\{[^}]*grid-template-columns:\s*24px;[^}]*padding:\s*4px;/s,
  );
  assertNotMatch(
    css,
    /\.policy-palette-icon[^{]*\{[^}]*display:\s*none;/s,
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
