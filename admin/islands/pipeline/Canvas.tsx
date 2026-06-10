/** @jsxImportSource preact */
import { useRef } from 'preact/hooks';
import {
  buildMinimapModel,
  DEFAULT_CANVAS_SIZE,
  minimapNodeRect,
  nodeHeight,
  nodeWidth,
  type Size,
} from './minimap.ts';
import { useCanvasInteractions } from './use_canvas_interactions.ts';
import { shouldRenderRunAction, shouldRenderSettingsAction } from './config_editor.js';
import type { PipelineEdge, PipelineGraph, PipelineNode, Rect, Viewport } from './types.ts';

const DEFAULT_VIEWPORT: Viewport = { zoom: 1, pan: { x: 56, y: 80 } };

export function Canvas(props: {
  graph: PipelineGraph;
  selectedNodeIds: string[];
  marquee?: Rect | null;
  viewport?: Viewport;
  canvasSize?: Size;
  onViewportChange?(viewport: Viewport): void;
  onNodeSelect?(nodeId: string, additive: boolean): void;
  onSelectionReplace?(nodeIds: string[]): void;
  onMarqueeChange?(rect: Rect | null): void;
  onNodeMove?(nodeId: string, position: { x: number; y: number }): void;
  onEdgeReplace?(from: string, fromPort: string, to: string): void;
  onNodeDoubleClick(nodeId: string): void;
}) {
  const viewport = props.viewport ?? DEFAULT_VIEWPORT;
  const canvasSize = props.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const minimap = buildMinimapModel(props.graph, viewport, canvasSize);
  const selectedNodeIds = new Set(props.selectedNodeIds);
  const marqueeStyle = props.marquee
    ? {
      display: 'block',
      left: `${props.marquee.x}px`,
      top: `${props.marquee.y}px`,
      width: `${props.marquee.width}px`,
      height: `${props.marquee.height}px`,
    }
    : { display: 'none' };
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapRef = useRef<SVGSVGElement>(null);
  const interactions = useCanvasInteractions({
    graph: props.graph,
    selectedNodeIds: props.selectedNodeIds,
    viewport,
    minimap,
    svgRef,
    minimapRef,
    onViewportChange: props.onViewportChange,
    onNodeSelect: props.onNodeSelect,
    onSelectionReplace: props.onSelectionReplace,
    onMarqueeChange: props.onMarqueeChange,
    onNodeMove: props.onNodeMove,
    onEdgeReplace: props.onEdgeReplace,
  });

  return (
    <div
      class='pipeline-canvas'
      id='pipeline-canvas'
      role='region'
      aria-label='Pipeline canvas'
    >
      <div
        class='selection-marquee'
        id='selection-marquee'
        style={marqueeStyle}
      >
      </div>
      <svg
        ref={svgRef}
        class='pipeline-svg'
        id='pipeline-svg'
        aria-label='Pipeline graph'
        onPointerDown={(event) => interactions.onCanvasPointerDown(event)}
        onWheel={(event) => interactions.onWheel(event)}
      >
        <g
          class='pipeline-viewport'
          transform={`translate(${viewport.pan.x}, ${viewport.pan.y}) scale(${viewport.zoom})`}
        >
          <g class='pipeline-edge-layer'>
            {props.graph.edges.map((edge) => {
              const path = edgePath(props.graph, edge);
              if (!path) return null;
              return (
                <path
                  key={edge.id}
                  class='pipeline-edge'
                  data-edge-id={edge.id}
                  data-edge-from={edge.from}
                  data-edge-from-port={edge.fromPort ?? ''}
                  data-edge-to={edge.to}
                  data-edge-to-port={edge.toPort ?? ''}
                  d={path}
                />
              );
            })}
          </g>
          <g class='pipeline-node-layer'>
            {props.graph.nodes.map((node) => {
              const width = nodeWidth(node);
              const height = nodeHeight(node);
              const action = nodeAction(node);
              const classes = [
                'pipeline-node',
                isStartNode(node) ? 'pipeline-node-start' : '',
                selectedNodeIds.has(node.id) ? 'selected' : '',
              ].filter(Boolean).join(' ');

              return (
                <g
                  key={node.id}
                  class={classes}
                  transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
                  data-node-id={node.id}
                  data-node-policy={node.policy ?? ''}
                  data-node-type={node.type ?? ''}
                  data-node-config={formatNodeConfig(node.config)}
                  onPointerDown={(event) => interactions.onNodePointerDown(event, node)}
                  onDblClick={() => props.onNodeDoubleClick(node.id)}
                >
                  <rect
                    class='pipeline-node-card'
                    width={width}
                    height={height}
                    rx='8'
                  />
                  <text class='pipeline-node-title' x='16' y='28'>
                    {node.policy ?? node.id}
                  </text>
                  <text class='pipeline-node-subtitle' x='16' y='50'>
                    {nodeSubtitle(node)}
                  </text>
                  {action
                    ? (
                      <g
                        class='pipeline-node-action'
                        transform={`translate(${width - 27}, 19)`}
                        data-node-id={node.id}
                        data-node-action={action.type}
                        role='button'
                        tabIndex={0}
                        aria-label={action.title}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onNodeDoubleClick(node.id);
                        }}
                      >
                        <title>{action.title}</title>
                        <rect
                          class='pipeline-node-action-bg'
                          x='-12'
                          y='-12'
                          width='24'
                          height='24'
                          rx='6'
                        />
                        <text
                          class='pipeline-node-action-label'
                          x='0'
                          y='5'
                          text-anchor='middle'
                        >
                          {action.label}
                        </text>
                      </g>
                    )
                    : null}
                  {!isStartNode(node)
                    ? (
                      <circle
                        class='pipeline-port pipeline-port-input'
                        cx='0'
                        cy={height / 2}
                        r='6'
                        role='button'
                        tabIndex={0}
                        aria-label={`Input port for ${node.policy ?? node.id}`}
                        data-node-id={node.id}
                        data-port-kind='input'
                        data-port-name='in'
                      />
                    )
                    : null}
                  <circle
                    class='pipeline-port pipeline-port-output'
                    cx={width}
                    cy={height / 2}
                    r='6'
                    role='button'
                    tabIndex={0}
                    aria-label={`Output port for ${node.policy ?? node.id}`}
                    data-node-id={node.id}
                    data-port-kind='output'
                    data-port-name='next'
                    onPointerDown={(event) => interactions.onOutputPointerDown(event, node.id, 'next')}
                  />
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <svg
        ref={minimapRef}
        class='canvas-minimap'
        id='minimap-svg'
        aria-label='Pipeline minimap'
        viewBox={`0 0 ${minimap.width} ${minimap.height}`}
      >
        <rect
          class='minimap-bg'
          x='0'
          y='0'
          width={minimap.width}
          height={minimap.height}
          rx='8'
          onPointerDown={(event) => interactions.onMinimapPointerDown(event, false)}
        />
        {props.graph.edges.map((edge) => {
          const from = props.graph.nodes.find((node) => node.id === edge.from);
          const to = props.graph.nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={edge.id}
              class='minimap-edge'
              x1={minimap.offsetX + ((from.x ?? 0) + nodeWidth(from)) * minimap.scale}
              y1={minimap.offsetY + ((from.y ?? 0) + nodeHeight(from) / 2) * minimap.scale}
              x2={minimap.offsetX + (to.x ?? 0) * minimap.scale}
              y2={minimap.offsetY + ((to.y ?? 0) + nodeHeight(to) / 2) * minimap.scale}
            />
          );
        })}
        {props.graph.nodes.map((node) => {
          const rect = minimapNodeRect(minimap, node);
          return (
            <rect
              key={node.id}
              class={selectedNodeIds.has(node.id) ? 'minimap-node selected' : 'minimap-node'}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx='3'
            />
          );
        })}
        <rect
          class='minimap-viewport'
          x={minimap.viewportRect.x}
          y={minimap.viewportRect.y}
          width={Math.max(4, minimap.viewportRect.width)}
          height={Math.max(4, minimap.viewportRect.height)}
          rx='3'
          onPointerDown={(event) => interactions.onMinimapPointerDown(event, true)}
        />
      </svg>
    </div>
  );
}

function edgePath(graph: PipelineGraph, edge: PipelineEdge): string {
  const from = graph.nodes.find((node) => node.id === edge.from);
  const to = graph.nodes.find((node) => node.id === edge.to);
  if (!from || !to) return '';

  const x1 = (from.x ?? 0) + nodeWidth(from);
  const y1 = (from.y ?? 0) + nodeHeight(from) / 2;
  const x2 = to.x ?? 0;
  const y2 = (to.y ?? 0) + nodeHeight(to) / 2;
  const tension = Math.max(80, Math.abs(x2 - x1) * 0.45);

  return `M ${x1} ${y1} C ${x1 + tension} ${y1}, ${x2 - tension} ${y2}, ${x2} ${y2}`;
}

function isStartNode(node: PipelineNode): boolean {
  return node.type === 'start' || node.policy === 'start';
}

function nodeAction(node: PipelineNode): {
  type: 'run' | 'settings';
  label: string;
  title: string;
} | null {
  if (shouldRenderRunAction(node)) {
    return { type: 'run', label: 'R', title: 'Run playground' };
  }
  if (shouldRenderSettingsAction(node)) {
    return { type: 'settings', label: 'S', title: 'Node settings' };
  }
  return null;
}

function nodeSubtitle(node: PipelineNode): string {
  if (isStartNode(node)) return 'Pipeline start';
  return node.id;
}

function formatNodeConfig(config: unknown): string {
  if (config === undefined) return '';
  return JSON.stringify(config);
}
