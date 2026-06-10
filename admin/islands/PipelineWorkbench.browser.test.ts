import { assertEquals } from '@std/assert';
import { propsFromFreshBootValue } from './PipelineWorkbench.browser.tsx';

Deno.test('PipelineWorkbench browser adapter decodes Fresh serialized boot props', () => {
  const serialized = JSON.stringify([
    [1],
    { slots: 2, props: 3 },
    [],
    { initialPipelines: 4, initialPlugins: 9 },
    { client: 5, server: 8 },
    [6],
    { policy: 7 },
    'accept',
    [],
    [7, 10],
    'write-guard',
  ]);

  assertEquals(propsFromFreshBootValue(serialized), {
    initialPipelines: {
      client: [{ policy: 'accept' }],
      server: [],
    },
    initialPlugins: ['accept', 'write-guard'],
  });
});

Deno.test('PipelineWorkbench browser adapter accepts decoded props records', () => {
  const decoded = {
    initialPipelines: { client: [], server: [] },
    initialPlugins: ['accept'],
  };

  assertEquals(propsFromFreshBootValue(decoded), decoded);
});
