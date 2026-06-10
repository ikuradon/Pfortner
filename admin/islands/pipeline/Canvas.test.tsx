/** @jsxImportSource preact */
import { assertStringIncludes } from '@std/assert';
import { render } from 'preact-render-to-string';
import { Canvas } from './Canvas.tsx';
import type { PipelineGraph } from './types.ts';

const graph: PipelineGraph = {
  direction: 'client',
  nodes: [
    { id: 'client-start', type: 'start', policy: 'start', x: 0, y: 0 },
    { id: 'client-node-1', type: 'policy', policy: 'accept', x: 240, y: 80 },
  ],
  edges: [
    {
      id: 'client-edge-1',
      from: 'client-start',
      fromPort: 'next',
      to: 'client-node-1',
      toPort: 'in',
    },
  ],
};

Deno.test('Canvas renders viewport transform and minimap viewport from reducer state', () => {
  const html = render(
    <Canvas
      graph={graph}
      selectedNodeIds={['client-node-1']}
      viewport={{ zoom: 1.25, pan: { x: 56, y: 80 } }}
      canvasSize={{ width: 800, height: 480 }}
      onNodeDoubleClick={() => undefined}
    />,
  );

  assertStringIncludes(html, 'class="pipeline-viewport"');
  assertStringIncludes(html, 'transform="translate(56, 80) scale(1.25)"');
  assertStringIncludes(html, 'class="canvas-minimap"');
  assertStringIncludes(html, 'viewBox="0 0 160 96"');
  assertStringIncludes(html, 'class="minimap-viewport"');
  assertStringIncludes(html, 'class="minimap-node selected"');
});
