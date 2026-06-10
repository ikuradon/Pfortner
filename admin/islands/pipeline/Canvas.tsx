/** @jsxImportSource preact */
import type { PipelineEdge, PipelineGraph, PipelineNode } from './types.ts';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 72;

export function Canvas(props: {
  graph: PipelineGraph;
  selectedNodeIds: string[];
  onNodePointerDown(nodeId: string, event: PointerEvent): void;
  onNodeDoubleClick(nodeId: string): void;
}) {
  return (
    <div
      class='pipeline-canvas'
      id='pipeline-canvas'
      role='region'
      aria-label='Pipeline canvas'
    >
      <svg
        class='pipeline-svg'
        id='pipeline-svg'
        aria-label='Pipeline graph'
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
                d={path}
              />
            );
          })}
        </g>
        <g class='pipeline-node-layer'>
          {props.graph.nodes.map((node) => {
            const width = nodeWidth(node);
            const height = nodeHeight(node);
            const classes = [
              'pipeline-node',
              isStartNode(node) ? 'pipeline-node-start' : '',
              props.selectedNodeIds.includes(node.id) ? 'selected' : '',
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
                onPointerDown={(event) => props.onNodePointerDown(node.id, event as PointerEvent)}
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
              </g>
            );
          })}
        </g>
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

function nodeWidth(node: PipelineNode): number {
  return node.width ?? NODE_WIDTH;
}

function nodeHeight(node: PipelineNode): number {
  return node.height ?? NODE_HEIGHT;
}

function nodeSubtitle(node: PipelineNode): string {
  if (isStartNode(node)) return 'Pipeline start';
  return node.id;
}

function formatNodeConfig(config: unknown): string {
  if (config === undefined) return '';
  return JSON.stringify(config);
}
