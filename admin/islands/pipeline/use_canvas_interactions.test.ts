import { assertAlmostEquals, assertEquals } from '@std/assert';
import {
  graphPointFromClientPoint,
  nodePositionFromDrag,
  panViewportWithWheel,
  zoomViewportAtPoint,
} from './use_canvas_interactions.ts';
import type { Viewport } from './types.ts';

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
