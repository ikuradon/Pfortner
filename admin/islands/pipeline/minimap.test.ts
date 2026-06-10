import { assertAlmostEquals, assertEquals } from '@std/assert';
import { buildMinimapModel, graphBounds, panForMinimapViewportPoint, visibleGraphBounds } from './minimap.ts';
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

Deno.test('minimap model includes graph and visible viewport bounds', () => {
  assertEquals(graphBounds(graph), { x: 0, y: 0, width: 420, height: 152 });
  assertEquals(
    visibleGraphBounds(
      { zoom: 2, pan: { x: -100, y: -50 } },
      { width: 800, height: 400 },
    ),
    { x: 50, y: 25, width: 400, height: 200 },
  );

  const model = buildMinimapModel(
    graph,
    { zoom: 2, pan: { x: -100, y: -50 } },
    { width: 800, height: 400 },
  );

  assertEquals(model.width, 160);
  assertEquals(model.height, 96);
  assertEquals(model.content, { x: 0, y: 0, width: 450, height: 225 });
  assertAlmostEquals(model.viewportRect.x, model.offsetX + 50 * model.scale);
  assertAlmostEquals(model.viewportRect.y, model.offsetY + 25 * model.scale);
});

Deno.test('minimap model converts dragged viewport points back to canvas pan', () => {
  const viewport = { zoom: 2, pan: { x: -100, y: -50 } };
  const model = buildMinimapModel(graph, viewport, { width: 800, height: 400 });
  const pointerOffset = { x: 12, y: 10 };
  const point = {
    x: model.viewportRect.x + pointerOffset.x,
    y: model.viewportRect.y + pointerOffset.y,
  };

  const pan = panForMinimapViewportPoint(model, viewport.zoom, point, pointerOffset);

  assertAlmostEquals(pan.x, viewport.pan.x);
  assertAlmostEquals(pan.y, viewport.pan.y);
});
