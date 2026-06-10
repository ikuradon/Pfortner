import {
  applyHistoryChange,
  initialDirectionHistoryState,
  recordDirectionHistorySnapshot,
} from '../../static/pipeline_workbench_state.js';
import type {
  DirectionSelections,
  DirectionViewports,
  PipelineDirection,
  PipelineGraph,
  PipelineGraphs,
  Point,
  WorkbenchStatus,
} from './types.ts';

type PipelineGraphsInput = PipelineGraphs | Record<string, PipelineGraph>;

export interface WorkbenchState {
  direction: PipelineDirection;
  graphs: PipelineGraphs;
  history: ReturnType<typeof initialDirectionHistoryState>;
  viewports: DirectionViewports;
  selectedNodeIds: string[];
  selectedNodeIdsByDirection: DirectionSelections;
  plugins: string[];
  publishedFingerprint: string;
  status: WorkbenchStatus;
}

export type WorkbenchAction =
  | { type: 'directionChanged'; direction: PipelineDirection }
  | { type: 'viewportChanged'; zoom: number; pan: Point }
  | { type: 'nodeMoved'; nodeId: string; x: number; y: number }
  | { type: 'undo' }
  | { type: 'redo' };

const DEFAULT_VIEWPORT: DirectionViewports = {
  client: { zoom: 1, pan: { x: 56, y: 80 } },
  server: { zoom: 1, pan: { x: 56, y: 80 } },
};

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function updateGraph(
  graphs: PipelineGraphs,
  direction: PipelineDirection,
  graph: PipelineGraph,
): PipelineGraphs {
  return {
    ...graphs,
    [direction]: graph,
  };
}

function emptyGraph(direction: PipelineDirection): PipelineGraph {
  return { direction, nodes: [], edges: [] };
}

function normalizePipelineGraphs(graphs: PipelineGraphsInput): PipelineGraphs {
  return {
    client: cloneValue(graphs.client ?? emptyGraph('client')),
    server: cloneValue(graphs.server ?? emptyGraph('server')),
  };
}

function emptyDirectionSelections(): DirectionSelections {
  return {
    client: [],
    server: [],
  };
}

export function createInitialWorkbenchState(input: {
  graphs: PipelineGraphsInput;
  plugins: string[];
  publishedFingerprint: string;
}): WorkbenchState {
  const graphs = normalizePipelineGraphs(input.graphs);
  return {
    direction: 'client',
    graphs,
    history: initialDirectionHistoryState(graphs),
    viewports: cloneValue(DEFAULT_VIEWPORT),
    selectedNodeIds: [],
    selectedNodeIdsByDirection: emptyDirectionSelections(),
    plugins: [...input.plugins],
    publishedFingerprint: input.publishedFingerprint,
    status: { message: 'Ready', kind: 'idle' },
  };
}

export function reduceWorkbench(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  if (action.type === 'directionChanged') {
    return {
      ...state,
      direction: action.direction,
      selectedNodeIds: [...state.selectedNodeIdsByDirection[action.direction]],
    };
  }

  if (action.type === 'viewportChanged') {
    return {
      ...state,
      viewports: {
        ...state.viewports,
        [state.direction]: {
          zoom: action.zoom,
          pan: { x: action.pan.x, y: action.pan.y },
        },
      },
    };
  }

  if (action.type === 'nodeMoved') {
    const graph = cloneValue(state.graphs[state.direction]);
    const node = graph.nodes.find((item) => item.id === action.nodeId);
    if (!node) return state;

    node.x = action.x;
    node.y = action.y;

    return {
      ...state,
      graphs: updateGraph(state.graphs, state.direction, graph),
      history: recordDirectionHistorySnapshot(
        state.history,
        state.direction,
        graph,
      ),
    };
  }

  if (action.type === 'undo' || action.type === 'redo') {
    const directionHistory = applyHistoryChange(
      state.history[state.direction],
      action.type,
    );
    if (directionHistory === state.history[state.direction]) return state;

    const history = {
      ...state.history,
      [state.direction]: directionHistory,
    };
    const selectedNodeIdsByDirection = {
      ...state.selectedNodeIdsByDirection,
      [state.direction]: [],
    };

    return {
      ...state,
      history,
      graphs: updateGraph(
        state.graphs,
        state.direction,
        cloneValue(directionHistory.present),
      ),
      selectedNodeIdsByDirection,
      selectedNodeIds: [],
    };
  }

  return state;
}
