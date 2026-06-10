import { assertMatch } from '@std/assert';

const css = await Deno.readTextFile(new URL('./styles.css', import.meta.url));

Deno.test('pipeline compact palette header centers toggle button in icon rail', () => {
  assertMatch(
    css,
    /\.pipeline-workbench\.palette-collapsed \.palette-header\s*\{[^}]*justify-content:\s*center;[^}]*padding:\s*10px 7px;/s,
  );
  assertMatch(
    css,
    /@media \(max-width: 900px\)\s*\{[\s\S]*?\.canvas-first-grid \.palette-header\s*\{[^}]*justify-content:\s*center;[^}]*padding:\s*10px 7px;/,
  );
});
