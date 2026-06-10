import { assertAlmostEquals, assertEquals } from '@std/assert';
import {
  fitViewportToGraph,
  graphPointFromClientPoint,
  inputPortNodeIdFromTarget,
  marqueeRectFromClientPoints,
  nodeIdsInMarquee,
  nodePositionFromDrag,
  panViewportWithWheel,
  zoomViewportAtPoint,
  zoomViewportByStep,
} from './use_canvas_interactions.ts';
import type { PipelineGraph, Viewport } from './types.ts';

const viewport: Viewport = {
  zoom: 1.25,
  pan: { x: 56, y: 80 },
};

const rect = {
  left: 10,
  top: 20,
  width: 800,
  height: 480,
};

Deno.test('canvas interactions pan viewport with n8n-style wheel semantics', () => {
  assertEquals(
    panViewportWithWheel(viewport, {
      deltaX: 40,
      deltaY: 24,
      deltaMode: 0,
      shiftKey: false,
    }),
    { zoom: 1.25, pan: { x: 16, y: 56 } },
  );

  assertEquals(
    panViewportWithWheel(viewport, {
      deltaX: 0,
      deltaY: 24,
      deltaMode: 0,
      shiftKey: true,
    }),
    { zoom: 1.25, pan: { x: 32, y: 80 } },
  );
});

Deno.test('canvas interactions zoom around the cursor and clamp the zoom', () => {
  const zoomed = zoomViewportAtPoint(
    viewport,
    2.4,
    { clientX: 410, clientY: 260 },
    rect,
  );

  assertEquals(zoomed.zoom, 1.8);
  assertAlmostEquals(
    (410 - rect.left - zoomed.pan.x) / zoomed.zoom,
    (410 - rect.left - viewport.pan.x) / viewport.zoom,
  );
  assertAlmostEquals(
    (260 - rect.top - zoomed.pan.y) / zoomed.zoom,
    (260 - rect.top - viewport.pan.y) / viewport.zoom,
  );
});

Deno.test('canvas interactions zoom toolbar changes zoom without moving pan', () => {
  assertEquals(zoomViewportByStep(viewport, 0.1), {
    zoom: 1.35,
    pan: { x: 56, y: 80 },
  });
  assertEquals(zoomViewportByStep({ zoom: 1.78, pan: { x: 5, y: 6 } }, 0.1), {
    zoom: 1.8,
    pan: { x: 5, y: 6 },
  });
  assertEquals(zoomViewportByStep({ zoom: 0.38, pan: { x: 5, y: 6 } }, -0.1), {
    zoom: 0.35,
    pan: { x: 5, y: 6 },
  });
});

Deno.test('canvas interactions fit viewport around graph bounds', () => {
  const graph: PipelineGraph = {
    direction: 'client',
    nodes: [
      { id: 'client-start', type: 'start', policy: 'start', x: 0, y: 0 },
      { id: 'client-node-1', type: 'policy', policy: 'accept', x: 300, y: 128 },
    ],
    edges: [],
  };

  assertEquals(fitViewportToGraph(graph, { width: 800, height: 480 }), {
    zoom: 1.4,
    pan: { x: 64, y: 100 },
  });
});

Deno.test('canvas interactions convert client points and node drags through viewport state', () => {
  const start = graphPointFromClientPoint(
    viewport,
    { clientX: 191, clientY: 205 },
    rect,
  );
  const current = graphPointFromClientPoint(
    viewport,
    { clientX: 241, clientY: 255 },
    rect,
  );

  assertEquals(start, { x: 100, y: 84 });
  assertEquals(current, { x: 140, y: 124 });
  assertEquals(
    nodePositionFromDrag(
      { x: 240, y: 80 },
      start,
      current,
    ),
    { x: 280, y: 120 },
  );
});

Deno.test('canvas interactions read input port targets for wire replacement', () => {
  const inputPort = {
    getAttribute(name: string): string | null {
      const values: Record<string, string> = {
        'data-port-kind': 'input',
        'data-port-name': 'in',
        'data-node-id': 'client-node-2',
      };
      return values[name] ?? null;
    },
  };
  const child = {
    closest(selector: string): typeof inputPort | null {
      return selector === '[data-port-kind="input"]' ? inputPort : null;
    },
  };
  const outputPort = {
    getAttribute(name: string): string | null {
      const values: Record<string, string> = {
        'data-port-kind': 'output',
        'data-port-name': 'next',
        'data-node-id': 'client-node-1',
      };
      return values[name] ?? null;
    },
  };

  assertEquals(inputPortNodeIdFromTarget(inputPort), 'client-node-2');
  assertEquals(inputPortNodeIdFromTarget(child), 'client-node-2');
  assertEquals(inputPortNodeIdFromTarget(outputPort), null);
  assertEquals(inputPortNodeIdFromTarget(null), null);
});

Deno.test('canvas interactions calculate marquee rect and selected node ids', () => {
  const graph: PipelineGraph = {
    direction: 'client',
    nodes: [
      { id: 'client-start', type: 'start', policy: 'start', x: 0, y: 0 },
      { id: 'client-node-1', type: 'policy', policy: 'accept', x: 240, y: 80 },
      { id: 'client-node-2', type: 'policy', policy: 'rate-limit', x: 560, y: 240 },
    ],
    edges: [],
  };
  const marquee = marqueeRectFromClientPoints(
    { clientX: 30, clientY: 40 },
    { clientX: 390, clientY: 220 },
    { left: 10, top: 20, width: 800, height: 480 },
  );

  assertEquals(marquee, { x: 20, y: 20, width: 360, height: 180 });
  assertEquals(
    nodeIdsInMarquee(
      graph,
      viewport,
      { left: 10, top: 20, width: 800, height: 480 },
      marquee,
    ),
    ['client-start', 'client-node-1'],
  );
});
