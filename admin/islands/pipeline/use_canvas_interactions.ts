import { useEffect, useRef } from 'preact/hooks';
import { graphBounds, type MinimapModel, panForMinimapViewportPoint, type Size } from './minimap.ts';
import { nodeHeight, nodeWidth } from './minimap.ts';
import type { PipelineGraph, PipelineNode, Point, Rect, Viewport, WirePreview } from './types.ts';

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
    nodeIds: string[];
    startGraphPoint: Point;
    nodeStarts: Record<string, Point>;
  }
  | {
    type: 'pan';
    start: ClientPoint;
    startPan: Point;
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
  }
  | {
    type: 'marquee';
    start: ClientPoint;
  };

export interface CanvasInteractions {
  onWheel(event: WheelEvent): void;
  onCanvasPointerDown(event: PointerEvent): void;
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

function clampZoom(value: number, min = 0.35, max = 1.8): number {
  return Math.max(min, Math.min(max, value));
}

export function zoomViewportByStep(
  viewport: Viewport,
  step: number,
): Viewport {
  return {
    zoom: clampZoom(viewport.zoom + step),
    pan: { x: viewport.pan.x, y: viewport.pan.y },
  };
}

export function fitViewportToGraph(
  graph: PipelineGraph,
  canvasSize: Size,
): Viewport {
  const bounds = graphBounds(graph);
  const nextZoom = Math.min(
    1.4,
    Math.max(
      0.35,
      Math.min(
        (canvasSize.width - 80) / bounds.width,
        (canvasSize.height - 80) / bounds.height,
      ),
    ),
  );
  const zoom = Number.isFinite(nextZoom) ? nextZoom : 1;
  return {
    zoom,
    pan: {
      x: 40 - bounds.x * zoom +
        Math.max(0, (canvasSize.width - bounds.width * zoom) / 2 - 40),
      y: 40 - bounds.y * zoom +
        Math.max(0, (canvasSize.height - bounds.height * zoom) / 2 - 40),
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

function snapToGrid(value: number, grid = 8): number {
  return Math.round(value / grid) * grid;
}

export function nodePositionFromDrag(
  nodeStart: Point,
  startGraphPoint: Point,
  currentGraphPoint: Point,
): Point {
  return {
    x: snapToGrid(nodeStart.x + currentGraphPoint.x - startGraphPoint.x),
    y: snapToGrid(nodeStart.y + currentGraphPoint.y - startGraphPoint.y),
  };
}

export function nodeDragSelection(
  selectedNodeIds: string[],
  nodeId: string,
  additive: boolean,
): string[] {
  if (selectedNodeIds.includes(nodeId)) return [...selectedNodeIds];
  if (additive) return [...selectedNodeIds, nodeId];
  return [nodeId];
}

export function panViewportFromPointerDrag(
  viewport: Viewport,
  start: ClientPoint,
  current: ClientPoint,
): Viewport {
  return {
    zoom: viewport.zoom,
    pan: {
      x: viewport.pan.x + current.clientX - start.clientX,
      y: viewport.pan.y + current.clientY - start.clientY,
    },
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

export function marqueeRectFromClientPoints(
  start: ClientPoint,
  current: ClientPoint,
  containerRect: CanvasRect,
): Rect {
  const x1 = Math.min(start.clientX, current.clientX) - containerRect.left;
  const y1 = Math.min(start.clientY, current.clientY) - containerRect.top;
  const x2 = Math.max(start.clientX, current.clientX) - containerRect.left;
  const y2 = Math.max(start.clientY, current.clientY) - containerRect.top;
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

export function nodeIdsInMarquee(
  graph: PipelineGraph,
  viewport: Viewport,
  _containerRect: CanvasRect,
  marquee: Rect,
): string[] {
  const left = marquee.x;
  const top = marquee.y;
  const right = marquee.x + marquee.width;
  const bottom = marquee.y + marquee.height;
  return (graph.nodes ?? [])
    .filter((node) => {
      const sx = viewport.pan.x + (node.x ?? 0) * viewport.zoom;
      const sy = viewport.pan.y + (node.y ?? 0) * viewport.zoom;
      const ex = sx + nodeWidth(node) * viewport.zoom;
      const ey = sy + nodeHeight(node) * viewport.zoom;
      return ex >= left && sx <= right && ey >= top && sy <= bottom;
    })
    .map((node) => node.id);
}

function isPrimaryButton(event: PointerEvent): boolean {
  return event.button === undefined || event.button === 0;
}

interface PointerModeInput {
  button?: number;
  altKey?: boolean;
}

export function canvasPointerMode(input: PointerModeInput): 'marquee' | 'pan' | 'ignore' {
  if (input.button === 1 || input.altKey) return 'pan';
  if (input.button === undefined || input.button === 0) return 'marquee';
  return 'ignore';
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

export function inputPortNodeIdFromPointerEvent(
  event: ClientPoint & { target?: unknown },
): string | null {
  const pointedElement = typeof document === 'undefined'
    ? null
    : document.elementFromPoint?.(event.clientX, event.clientY) ?? null;
  return inputPortNodeIdFromTarget(pointedElement) ??
    inputPortNodeIdFromTarget(event.target);
}

export function useCanvasInteractions(options: {
  graph: PipelineGraph;
  selectedNodeIds: string[];
  viewport: Viewport;
  minimap: MinimapModel;
  svgRef: ElementRef<SVGSVGElement>;
  minimapRef: ElementRef<SVGSVGElement>;
  onViewportChange?(viewport: Viewport): void;
  onNodeSelect?(nodeId: string, additive: boolean): void;
  onSelectionReplace?(nodeIds: string[]): void;
  onMarqueeChange?(rect: Rect | null): void;
  onNodeMove?(nodeId: string, position: Point, transient?: boolean): void;
  onNodeDragCommit?(nodeIds: string[]): void;
  onEdgeReplace?(from: string, fromPort: string, to: string): void;
  onWirePreviewChange?(preview: WirePreview | null): void;
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
        for (const nodeId of state.nodeIds) {
          const nodeStart = state.nodeStarts[nodeId];
          if (!nodeStart) continue;
          options.onNodeMove?.(
            nodeId,
            nodePositionFromDrag(
              nodeStart,
              state.startGraphPoint,
              currentGraphPoint,
            ),
            true,
          );
        }
        return;
      }

      if (state.type === 'pan') {
        options.onViewportChange?.(
          panViewportFromPointerDrag(
            { zoom: options.viewport.zoom, pan: state.startPan },
            state.start,
            event,
          ),
        );
        return;
      }

      if (state.type === 'wire') {
        const rect = options.svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        options.onWirePreviewChange?.({
          from: state.from,
          fromPort: state.fromPort,
          point: graphPointFromClientPoint(options.viewport, event, rect),
        });
        return;
      }

      if (state.type === 'marquee') {
        const rect = options.svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        options.onMarqueeChange?.(
          marqueeRectFromClientPoints(state.start, event, rect),
        );
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
      if (state?.type === 'node') {
        options.onNodeDragCommit?.(state.nodeIds);
      }
      if (state?.type === 'wire') {
        const to = inputPortNodeIdFromPointerEvent(event);
        if (to) options.onEdgeReplace?.(state.from, state.fromPort, to);
        options.onWirePreviewChange?.(null);
      }
      if (state?.type === 'marquee') {
        const rect = options.svgRef.current?.getBoundingClientRect();
        if (rect) {
          const marquee = marqueeRectFromClientPoints(state.start, event, rect);
          options.onSelectionReplace?.(
            nodeIdsInMarquee(options.graph, options.viewport, rect, marquee),
          );
        }
        options.onMarqueeChange?.(null);
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

    onCanvasPointerDown(event) {
      const svg = options.svgRef.current;
      if (!svg || event.target !== svg) return;
      const mode = canvasPointerMode(event);
      if (mode === 'ignore') return;
      if (mode === 'pan') {
        if (!options.onViewportChange) return;
        event.preventDefault();
        dragState.current = {
          type: 'pan',
          start: { clientX: event.clientX, clientY: event.clientY },
          startPan: { x: options.viewport.pan.x, y: options.viewport.pan.y },
        };
        return;
      }

      if (!options.onSelectionReplace && !options.onMarqueeChange) return;
      event.preventDefault();
      options.onSelectionReplace?.([]);
      const rect = svg.getBoundingClientRect();
      const start = { clientX: event.clientX, clientY: event.clientY };
      dragState.current = {
        type: 'marquee',
        start,
      };
      options.onMarqueeChange?.(marqueeRectFromClientPoints(start, start, rect));
    },

    onNodePointerDown(event, node) {
      const mode = canvasPointerMode(event);
      if (mode === 'ignore') return;
      if (mode === 'pan') {
        if (!options.onViewportChange) return;
        event.preventDefault();
        event.stopPropagation();
        dragState.current = {
          type: 'pan',
          start: { clientX: event.clientX, clientY: event.clientY },
          startPan: { x: options.viewport.pan.x, y: options.viewport.pan.y },
        };
        return;
      }

      if (!options.onNodeMove) return;
      if (!isPrimaryButton(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const additive = event.shiftKey || event.metaKey;
      const alreadySelected = options.selectedNodeIds.includes(node.id);
      const selectedNodeIds = nodeDragSelection(
        options.selectedNodeIds,
        node.id,
        additive,
      );
      if (!alreadySelected) {
        options.onNodeSelect?.(node.id, additive);
      }
      const rect = options.svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nodeStarts = Object.fromEntries(
        selectedNodeIds.map((nodeId) => {
          const graphNode = options.graph.nodes.find((item) => item.id === nodeId);
          return [nodeId, { x: graphNode?.x ?? 0, y: graphNode?.y ?? 0 }];
        }),
      );
      dragState.current = {
        type: 'node',
        nodeIds: selectedNodeIds,
        startGraphPoint: graphPointFromClientPoint(
          options.viewport,
          event,
          rect,
        ),
        nodeStarts,
      };
    },

    onOutputPointerDown(event, nodeId, portName) {
      if (!options.onEdgeReplace) return;
      if (!isPrimaryButton(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragState.current = {
        type: 'wire',
        from: nodeId,
        fromPort: portName,
      };
      const rect = options.svgRef.current?.getBoundingClientRect();
      if (rect) {
        options.onWirePreviewChange?.({
          from: nodeId,
          fromPort: portName,
          point: graphPointFromClientPoint(options.viewport, event, rect),
        });
      }
    },

    onMinimapPointerDown(event, preserveViewportOffset) {
      if (!options.onViewportChange) return;
      if (!isPrimaryButton(event)) return;
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
