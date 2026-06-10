import type { PipelineGraph, PipelineNode, Point, Viewport } from './types.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface MinimapModel {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  viewport: Rect;
  content: Rect;
  viewportRect: Rect;
}

export interface OutputPort {
  id: string;
  label: string;
}

const NODE_WIDTH = 180;
const NODE_BASE_HEIGHT = 72;
const NODE_PORT_GAP = 18;
const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 96;
const MINIMAP_PADDING = 8;

export const DEFAULT_CANVAS_SIZE: Size = { width: 960, height: 540 };
export const DEFAULT_MINIMAP_SIZE: Size = {
  width: MINIMAP_WIDTH,
  height: MINIMAP_HEIGHT,
};

export function nodeWidth(node: PipelineNode): number {
  return node.width ?? NODE_WIDTH;
}

export function outputPortsForNode(node: PipelineNode | null | undefined): OutputPort[] {
  if (!node) return [];
  if (node.type === 'start' || node.policy === 'start') return [{ id: 'next', label: 'next' }];
  if (node.policy === 'when') {
    return [
      { id: 'then', label: 'then' },
      { id: 'else', label: 'else' },
      { id: 'next', label: 'next' },
    ];
  }
  if (node.policy === 'match') {
    const config = node.config as { cases?: unknown } | null | undefined;
    const cases = Array.isArray(config?.cases) ? config.cases : [];
    return cases.map((_, index) => ({
      id: `case:${index}`,
      label: `case ${index + 1}`,
    })).concat([
      { id: 'default', label: 'default' },
      { id: 'next', label: 'next' },
    ]);
  }
  return [{ id: 'next', label: 'next' }];
}

export function nodeHeight(node: PipelineNode): number {
  return node.height ?? Math.max(
    NODE_BASE_HEIGHT,
    42 + outputPortsForNode(node).length * NODE_PORT_GAP,
  );
}

export function inputPortPosition(node: PipelineNode): Point {
  return {
    x: node.x ?? 0,
    y: (node.y ?? 0) + nodeHeight(node) / 2,
  };
}

export function outputPortPosition(
  node: PipelineNode,
  portId: string | null | undefined,
): Point {
  const ports = outputPortsForNode(node);
  const index = Math.max(0, ports.findIndex((port) => port.id === portId));
  return {
    x: (node.x ?? 0) + nodeWidth(node),
    y: (node.y ?? 0) + 28 + index * NODE_PORT_GAP,
  };
}

export function graphBounds(graph: PipelineGraph): Rect {
  const nodes = graph.nodes ?? [];
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x ?? 0));
  const minY = Math.min(...nodes.map((node) => node.y ?? 0));
  const maxX = Math.max(...nodes.map((node) => (node.x ?? 0) + nodeWidth(node)));
  const maxY = Math.max(...nodes.map((node) => (node.y ?? 0) + nodeHeight(node)));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function visibleGraphBounds(
  viewport: Viewport,
  canvasSize: Size = DEFAULT_CANVAS_SIZE,
): Rect {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  return {
    x: -(viewport.pan.x ?? 0) / zoom,
    y: -(viewport.pan.y ?? 0) / zoom,
    width: Math.max(1, canvasSize.width / zoom),
    height: Math.max(1, canvasSize.height / zoom),
  };
}

export function unionBounds(a: Rect, b: Rect): Rect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function buildMinimapModel(
  graph: PipelineGraph,
  viewport: Viewport,
  canvasSize: Size = DEFAULT_CANVAS_SIZE,
  minimapSize: Size = DEFAULT_MINIMAP_SIZE,
): MinimapModel {
  const visible = visibleGraphBounds(viewport, canvasSize);
  const content = unionBounds(graphBounds(graph), visible);
  const scale = Math.min(
    (minimapSize.width - MINIMAP_PADDING * 2) / Math.max(1, content.width),
    (minimapSize.height - MINIMAP_PADDING * 2) / Math.max(1, content.height),
  );
  const offsetX = MINIMAP_PADDING - content.x * scale;
  const offsetY = MINIMAP_PADDING - content.y * scale;
  return {
    width: minimapSize.width,
    height: minimapSize.height,
    scale,
    offsetX,
    offsetY,
    viewport: visible,
    content,
    viewportRect: {
      x: offsetX + visible.x * scale,
      y: offsetY + visible.y * scale,
      width: visible.width * scale,
      height: visible.height * scale,
    },
  };
}

export function minimapNodeRect(
  model: MinimapModel,
  node: PipelineNode,
): Rect {
  return {
    x: model.offsetX + (node.x ?? 0) * model.scale,
    y: model.offsetY + (node.y ?? 0) * model.scale,
    width: nodeWidth(node) * model.scale,
    height: nodeHeight(node) * model.scale,
  };
}

export function panForMinimapViewportPoint(
  model: MinimapModel,
  zoom: number,
  point: Point,
  pointerOffset: Point,
): Point {
  const nextViewportX = point.x - pointerOffset.x;
  const nextViewportY = point.y - pointerOffset.y;
  return {
    x: -((nextViewportX - model.offsetX) / model.scale) * zoom,
    y: -((nextViewportY - model.offsetY) / model.scale) * zoom,
  };
}
