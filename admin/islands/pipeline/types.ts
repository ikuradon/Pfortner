export type PipelineDirection = 'client' | 'server';

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  zoom: number;
  pan: Point;
}

export interface DirectionViewports {
  client: Viewport;
  server: Viewport;
}

export interface DirectionSelections {
  client: string[];
  server: string[];
}

export interface PipelineGraph {
  direction?: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface PipelineGraphs {
  client: PipelineGraph;
  server: PipelineGraph;
}

export interface PipelineNode {
  id: string;
  type?: string;
  policy?: string;
  config?: unknown;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  path?: unknown[];
}

export interface PipelineEdge {
  id: string;
  from: string;
  fromPort?: string;
  to: string;
  toPort?: string;
}

export interface WorkbenchStatus {
  message: string;
  kind: 'idle' | 'info' | 'warning' | 'error' | 'success';
}

export type ActiveModal =
  | { type: 'none' }
  | {
    type: 'settings';
    nodeId: string;
    mode: 'interactive' | 'json';
    json: string;
    error: string;
  }
  | { type: 'playground'; nodeId: string | null }
  | { type: 'publish'; yaml: string };
