/** @jsxImportSource preact */
import { assertStringIncludes } from '@std/assert';
import { render } from 'preact-render-to-string';
import { Palette } from './Palette.tsx';

Deno.test('Palette renders semantic policy icons instead of first-letter badges', () => {
  const html = render(
    <Palette
      plugins={['accept', 'write-guard', 'ip-filter', 'route']}
      collapsed={false}
      onToggle={() => undefined}
      onAdd={() => undefined}
    />,
  );

  assertStringIncludes(html, 'data-policy="accept"');
  assertStringIncludes(html, 'title="accept"');
  assertStringIncludes(html, '>✓</span>');
  assertStringIncludes(html, 'title="write-guard"');
  assertStringIncludes(html, '>✎</span>');
  assertStringIncludes(html, 'title="ip-filter"');
  assertStringIncludes(html, '>🌐</span>');
  assertStringIncludes(html, 'title="route"');
  assertStringIncludes(html, '>→</span>');
});
