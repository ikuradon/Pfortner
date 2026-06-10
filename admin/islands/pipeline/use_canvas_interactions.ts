import { useEffect, useRef } from 'preact/hooks';
import { type MinimapModel, panForMinimapViewportPoint, type Size } from './minimap.ts';
import type { PipelineGraph, PipelineNode, Point, Viewport } from './types.ts';

interface ElementRef<T extends Element> {
  current: T | null;
}

interface ClientPoint {
  clientX: number;
  clientY: number;
}

interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  shiftKey?: boolean;
}

type DragState =
  | {
    type: 'node';
    nodeId: string;
    startGraphPoint: Point;
    nodeStart: Point;
  }
  | {
    type: 'minimap';
    model: MinimapModel;
    pointerOffset: Point;
  }
  | {
    type: 'wire';
    from: string;
    fromPort: string;
  };

export interface CanvasInteractions {
  onWheel(event: WheelEvent): void;
  onNodePointerDown(event: PointerEvent, node: PipelineNode): void;
  onOutputPointerDown(event: PointerEvent, nodeId: string, portName: string): void;
  onMinimapPointerDown(event: PointerEvent, preserveViewportOffset: boolean): void;
}

export function wheelDeltaFactor(input: WheelInput): number {
  if (input.deltaMode === 1) return 16;
  if (input.deltaMode === 2) return 80;
  return 1;
}

export function panViewportWithWheel(
  viewport: Viewport,
  input: WheelInput,
): Viewport {
  const factor = wheelDeltaFactor(input);
  const deltaX = Number(input.deltaX || 0) * factor;
  const deltaY = Number(input.deltaY || 0) * factor;
  return {
    zoom: viewport.zoom,
    pan: {
      x: viewport.pan.x - (input.shiftKey && deltaX === 0 ? deltaY : deltaX),
      y: viewport.pan.y - (input.shiftKey ? 0 : deltaY),
    },
  };
}

export function zoomViewportAtPoint(
  viewport: Viewport,
  nextZoom: number,
  point: ClientPoint,
  rect: CanvasRect,
): Viewport {
  const oldZoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const zoom = Math.max(0.35, Math.min(1.8, nextZoom));
  const x = point.clientX - rect.left;
  const y = point.clientY - rect.top;
  return {
    zoom,
    pan: {
      x: x - ((x - viewport.pan.x) / oldZoom) * zoom,
      y: y - ((y - viewport.pan.y) / oldZoom) * zoom,
    },
  };
}

export function zoomViewportWithWheel(
  viewport: Viewport,
  input: WheelInput,
  point: ClientPoint,
  rect: CanvasRect,
): Viewport {
  return zoomViewportAtPoint(
    viewport,
    viewport.zoom * (input.deltaY > 0 ? 0.92 : 1.08),
    point,
    rect,
  );
}

export function graphPointFromClientPoint(
  viewport: Viewport,
  point: ClientPoint,
  rect: CanvasRect,
): Point {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  return {
    x: (point.clientX - rect.left - viewport.pan.x) / zoom,
    y: (point.clientY - rect.top - viewport.pan.y) / zoom,
  };
}

export function nodePositionFromDrag(
  nodeStart: Point,
  startGraphPoint: Point,
  currentGraphPoint: Point,
): Point {
  return {
    x: nodeStart.x + currentGraphPoint.x - startGraphPoint.x,
    y: nodeStart.y + currentGraphPoint.y - startGraphPoint.y,
  };
}

export function minimapPointFromClientPoint(
  point: ClientPoint,
  rect: CanvasRect,
  minimapSize: Size,
): Point {
  return {
    x: ((point.clientX - rect.left) / Math.max(1, rect.width)) * minimapSize.width,
    y: ((point.clientY - rect.top) / Math.max(1, rect.height)) * minimapSize.height,
  };
}

interface PortTargetLike {
  getAttribute?(name: string): string | null;
  closest?(selector: string): PortTargetLike | null;
}

function asPortTargetLike(target: unknown): PortTargetLike | null {
  return target !== null && typeof target === 'object' ? target as PortTargetLike : null;
}

export function inputPortNodeIdFromTarget(target: unknown): string | null {
  const candidate = asPortTargetLike(target);
  const port = candidate?.getAttribute?.('data-port-kind') === 'input'
    ? candidate
    : candidate?.closest?.('[data-port-kind="input"]') ?? null;
  if (port?.getAttribute?.('data-port-kind') !== 'input') return null;
  if (port.getAttribute('data-port-name') !== 'in') return null;
  const nodeId = port.getAttribute('data-node-id');
  return nodeId && nodeId.length > 0 ? nodeId : null;
}

export function useCanvasInteractions(options: {
  graph: PipelineGraph;
  viewport: Viewport;
  minimap: MinimapModel;
  svgRef: ElementRef<SVGSVGElement>;
  minimapRef: ElementRef<SVGSVGElement>;
  onViewportChange?(viewport: Viewport): void;
  onNodeMove?(nodeId: string, position: Point): void;
  onEdgeReplace?(from: string, fromPort: string, to: string): void;
}): CanvasInteractions {
  const dragState = useRef<DragState | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    function handlePointerMove(event: PointerEvent): void {
      const state = dragState.current;
      if (!state) return;

      if (state.type === 'node') {
        const rect = options.svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const currentGraphPoint = graphPointFromClientPoint(
          options.viewport,
          event,
          rect,
        );
        options.onNodeMove?.(
          state.nodeId,
          nodePositionFromDrag(
            state.nodeStart,
            state.startGraphPoint,
            currentGraphPoint,
          ),
        );
        return;
      }

      if (state.type === 'wire') {
        return;
      }

      const rect = options.minimapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = minimapPointFromClientPoint(event, rect, {
        width: state.model.width,
        height: state.model.height,
      });
      options.onViewportChange?.({
        zoom: options.viewport.zoom,
        pan: panForMinimapViewportPoint(
          state.model,
          options.viewport.zoom,
          point,
          state.pointerOffset,
        ),
      });
    }

    function handlePointerUp(event: PointerEvent): void {
      const state = dragState.current;
      if (state?.type === 'wire') {
        const to = inputPortNodeIdFromTarget(event.target);
        if (to) options.onEdgeReplace?.(state.from, state.fromPort, to);
      }
      dragState.current = null;
    }

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [options.graph, options.minimap, options.viewport]);

  return {
    onWheel(event) {
      if (!options.onViewportChange) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = options.svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        options.onViewportChange(
          zoomViewportWithWheel(options.viewport, event, event, rect),
        );
        return;
      }
      options.onViewportChange(panViewportWithWheel(options.viewport, event));
    },

    onNodePointerDown(event, node) {
      if (!options.onNodeMove) return;
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = options.svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragState.current = {
        type: 'node',
        nodeId: node.id,
        startGraphPoint: graphPointFromClientPoint(
          options.viewport,
          event,
          rect,
        ),
        nodeStart: { x: node.x ?? 0, y: node.y ?? 0 },
      };
    },

    onOutputPointerDown(event, nodeId, portName) {
      if (!options.onEdgeReplace) return;
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragState.current = {
        type: 'wire',
        from: nodeId,
        fromPort: portName,
      };
    },

    onMinimapPointerDown(event, preserveViewportOffset) {
      if (!options.onViewportChange) return;
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = options.minimapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = minimapPointFromClientPoint(event, rect, {
        width: options.minimap.width,
        height: options.minimap.height,
      });
      const pointerOffset = preserveViewportOffset
        ? {
          x: point.x - options.minimap.viewportRect.x,
          y: point.y - options.minimap.viewportRect.y,
        }
        : {
          x: options.minimap.viewportRect.width / 2,
          y: options.minimap.viewportRect.height / 2,
        };
      dragState.current = {
        type: 'minimap',
        model: options.minimap,
        pointerOffset,
      };
      options.onViewportChange({
        zoom: options.viewport.zoom,
        pan: panForMinimapViewportPoint(
          options.minimap,
          options.viewport.zoom,
          point,
          pointerOffset,
        ),
      });
    },
  };
}
