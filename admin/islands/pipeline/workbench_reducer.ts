import {
  applyHistoryChange,
  fingerprintPipelines,
  initialDirectionHistoryState,
  normalizeWorkbenchDraft,
  recordDirectionHistorySnapshot,
  recordHistorySnapshot,
} from './workbench_state.js';
import { graphToPipelines, matchExecutionSteps, pipelinesToGraph, validatePipelineGraph } from './graph.js';
import { defaultConfigForPolicy } from './node_defaults.ts';
import { buildYamlPreview } from './yaml_preview.ts';
import type {
  ActiveModal,
  DirectionSelections,
  DirectionViewports,
  PipelineDirection,
  PipelineEdge,
  PipelineGraph,
  PipelineGraphs,
  PipelineNode,
  Point,
  WorkbenchStatus,
} from './types.ts';

type PipelineGraphsInput = PipelineGraphs | Record<string, PipelineGraph>;
type SettingsMode = 'interactive' | 'json';
type WorkbenchModal = Exclude<ActiveModal, { type: 'playground' }> | {
  type: 'playground';
  nodeId: string | null;
  result?: unknown;
  error?: string;
};

interface WorkbenchUiState {
  activeModal: WorkbenchModal;
  paletteCollapsed: boolean;
}

type DirectionHistoryState = ReturnType<typeof initialDirectionHistoryState>['client'];

interface WorkbenchDirectionState {
  graph: PipelineGraph;
  viewport: DirectionViewports['client'];
  history: DirectionHistoryState;
  selectedNodeIds: string[];
  executionNodeIds: string[];
}

type WorkbenchDirectionStates = Record<PipelineDirection, WorkbenchDirectionState>;

export interface WorkbenchState {
  direction: PipelineDirection;
  directions: WorkbenchDirectionStates;
  graphs: PipelineGraphs;
  history: ReturnType<typeof initialDirectionHistoryState>;
  viewports: DirectionViewports;
  selectedNodeIds: string[];
  selectedNodeIdsByDirection: DirectionSelections;
  executionNodeIdsByDirection: DirectionSelections;
  plugins: string[];
  publishedFingerprint: string;
  savedDraftFingerprint: string;
  status: WorkbenchStatus;
  ui: WorkbenchUiState;
}

export type WorkbenchAction =
  | { type: 'directionChanged'; direction: PipelineDirection }
  | { type: 'viewportChanged'; zoom: number; pan: Point }
  | { type: 'nodeMoved'; nodeId: string; x: number; y: number }
  | { type: 'policyNodeAdded'; policy: string; position: Point }
  | { type: 'nodeDeleted'; nodeId: string }
  | { type: 'edgeReplaced'; from: string; fromPort: string; to: string }
  | { type: 'nodeDoubleClicked'; nodeId: string }
  | { type: 'modalClosed' }
  | { type: 'settingsModeChanged'; mode: SettingsMode }
  | { type: 'settingsJsonChanged'; value: string }
  | { type: 'settingsApplied' }
  | { type: 'publishModalOpened' }
  | { type: 'publishConfirmed' }
  | {
    type: 'initialDataLoaded';
    pipelines: unknown;
    plugins: string[];
    draft: unknown | null;
  }
  | {
    type: 'graphsLoaded';
    graphs: PipelineGraphsInput;
    viewports?: unknown;
    message: string;
    savedDraftFingerprint?: string;
  }
  | {
    type: 'draftSaved';
    message: string;
    kind?: WorkbenchStatus['kind'];
    savedDraftFingerprint?: string;
  }
  | { type: 'published'; pipelines: unknown; message?: string }
  | { type: 'loadFailed'; message: string }
  | { type: 'playgroundResultLoaded'; result: unknown }
  | { type: 'playgroundFailed'; message: string }
  | { type: 'paletteToggled' }
  | { type: 'undo' }
  | { type: 'redo' };

const NODE_WIDTH = 180;
const NODE_HEIGHT = 72;

const DEFAULT_VIEWPORT: DirectionViewports = {
  client: { zoom: 1, pan: { x: 56, y: 80 } },
  server: { zoom: 1, pan: { x: 56, y: 80 } },
};

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatSettingsJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2) ?? '{}';
}

function parseSettingsJson(
  json: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value = JSON.parse(json);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Config JSON must be an object.' };
    }
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error && error.message.length > 0 ? error.message : 'Unable to parse settings.';
    return { ok: false, error: `Invalid JSON: ${message}` };
  }
}

function setActiveModal(
  state: WorkbenchState,
  activeModal: WorkbenchModal,
): WorkbenchState {
  return {
    ...state,
    ui: {
      ...state.ui,
      activeModal,
    },
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        stableValue((value as Record<string, unknown>)[key]),
      ]),
    );
  }
  return value;
}

function draftFingerprint(
  graphs: PipelineGraphs,
  viewports: DirectionViewports,
): string {
  return JSON.stringify(stableValue({ graphs, viewports }));
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

function updateSelection(
  state: WorkbenchState,
  selectedNodeIds: string[],
): Pick<WorkbenchState, 'selectedNodeIds' | 'selectedNodeIdsByDirection'> {
  return {
    selectedNodeIds,
    selectedNodeIdsByDirection: {
      ...state.selectedNodeIdsByDirection,
      [state.direction]: selectedNodeIds,
    },
  };
}

function updateExecution(
  state: WorkbenchState,
  executionNodeIds: string[],
): Pick<WorkbenchState, 'executionNodeIdsByDirection'> {
  return {
    executionNodeIdsByDirection: {
      ...state.executionNodeIdsByDirection,
      [state.direction]: executionNodeIds,
    },
  };
}

function clearAllExecution(): DirectionSelections {
  return {
    client: [],
    server: [],
  };
}

function executionNodeIdsFromResult(
  graph: PipelineGraph,
  result: unknown,
): string[] {
  const record = result !== null && typeof result === 'object' ? result as Record<string, unknown> : {};
  const matches = matchExecutionSteps(
    graph,
    Array.isArray(record.steps) ? record.steps : [],
  );
  return Array.from(
    new Set(
      matches
        .map((match: { nodeId?: unknown }) => match.nodeId)
        .filter((nodeId): nodeId is string => typeof nodeId === 'string'),
    ),
  );
}

function graphDirection(
  graph: PipelineGraph,
  fallback: PipelineDirection,
): string {
  return typeof graph.direction === 'string' && graph.direction.length > 0 ? graph.direction : fallback;
}

function isStartNode(node: PipelineNode | null | undefined): boolean {
  return node?.type === 'start' || node?.policy === 'start';
}

function findNode(
  graph: PipelineGraph,
  nodeId: string,
): PipelineNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

function firstEdgeFromPort(
  graph: PipelineGraph,
  from: string,
  fromPort: string,
): PipelineEdge | undefined {
  return graph.edges.find((edge) => edge.from === from && edge.fromPort === fromPort);
}

function incomingEdge(
  graph: PipelineGraph,
  nodeId: string,
): PipelineEdge | undefined {
  return graph.edges.find((edge) => edge.to === nodeId);
}

function nextGraphSerial(graph: PipelineGraph, prefix: string): number {
  let max = 0;
  for (const item of [...(graph.nodes ?? []), ...(graph.edges ?? [])]) {
    const id = String(item.id ?? '');
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

function nextEdge(
  graph: PipelineGraph,
  direction: string,
  from: string,
  fromPort: string,
  to: string,
): PipelineEdge {
  return {
    id: `${direction}-edge-${nextGraphSerial(graph, `${direction}-edge-`)}`,
    from,
    fromPort,
    to,
    toPort: 'in',
  };
}

function recordCurrentGraph(
  state: WorkbenchState,
  graph: PipelineGraph,
): Pick<WorkbenchState, 'graphs' | 'history'> {
  return {
    graphs: updateGraph(state.graphs, state.direction, graph),
    history: recordDirectionHistorySnapshot(
      state.history,
      state.direction,
      graph,
    ),
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

function normalizePipelineEntries(value: unknown): {
  client: unknown[];
  server: unknown[];
} {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    client: Array.isArray(record.client) ? cloneValue(record.client) : [],
    server: Array.isArray(record.server) ? cloneValue(record.server) : [],
  };
}

function normalizeViewport(
  value: unknown,
  fallback: DirectionViewports['client'],
): DirectionViewports['client'] {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const pan = record.pan !== null && typeof record.pan === 'object' ? record.pan as Record<string, unknown> : {};
  const zoom = Number(record.zoom);
  const x = Number(pan.x);
  const y = Number(pan.y);
  return {
    zoom: Number.isFinite(zoom) ? Math.max(0.35, Math.min(1.8, zoom)) : fallback.zoom,
    pan: {
      x: Number.isFinite(x) ? x : fallback.pan.x,
      y: Number.isFinite(y) ? y : fallback.pan.y,
    },
  };
}

function normalizeViewports(
  value: unknown,
  fallback: DirectionViewports = DEFAULT_VIEWPORT,
): DirectionViewports {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    client: normalizeViewport(record.client, fallback.client),
    server: normalizeViewport(record.server, fallback.server),
  };
}

export function selectWorkbenchDraft(
  candidates: unknown[],
): { draft: any } | { error: string } {
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const normalized = normalizeWorkbenchDraft(candidate);
    if (!('error' in normalized)) return { draft: normalized.draft };
    errors.push(normalized.error);
  }
  return {
    error: errors[0] ?? 'No saved DAG found.',
  };
}

export function validateWorkbenchGraphsForPublish(
  graphs: PipelineGraphsInput,
): string {
  for (const direction of ['client', 'server'] as const) {
    const result = validatePipelineGraph(graphs[direction]);
    if (!result.valid) {
      const first = result.errors[0];
      const message = first?.message ?? first?.code ?? 'invalid graph';
      return `${direction} graph is invalid: ${message}`;
    }
  }
  return '';
}

function recordGraphsReplaceHistory(
  state: WorkbenchState,
  graphs: PipelineGraphs,
): WorkbenchState['history'] {
  return {
    client: recordHistorySnapshot(state.history.client, graphs.client),
    server: recordHistorySnapshot(state.history.server, graphs.server),
  };
}

function sanitizePlugins(plugins: string[]): string[] {
  return plugins.filter((plugin) => typeof plugin === 'string');
}

function emptyDirectionSelections(): DirectionSelections {
  return {
    client: [],
    server: [],
  };
}

function buildDirectionStates(
  state: Pick<
    WorkbenchState,
    | 'graphs'
    | 'history'
    | 'viewports'
    | 'selectedNodeIdsByDirection'
    | 'executionNodeIdsByDirection'
  >,
): WorkbenchDirectionStates {
  return {
    client: {
      graph: state.graphs.client,
      viewport: state.viewports.client,
      history: state.history.client,
      selectedNodeIds: state.selectedNodeIdsByDirection.client,
      executionNodeIds: state.executionNodeIdsByDirection.client,
    },
    server: {
      graph: state.graphs.server,
      viewport: state.viewports.server,
      history: state.history.server,
      selectedNodeIds: state.selectedNodeIdsByDirection.server,
      executionNodeIds: state.executionNodeIdsByDirection.server,
    },
  };
}

function withSyncedDirectionStates(state: WorkbenchState): WorkbenchState {
  return {
    ...state,
    directions: buildDirectionStates(state),
  };
}

export function createInitialWorkbenchState(input: {
  graphs: PipelineGraphsInput;
  plugins: string[];
  publishedFingerprint: string;
}): WorkbenchState {
  const graphs = normalizePipelineGraphs(input.graphs);
  const viewports = cloneValue(DEFAULT_VIEWPORT);
  return withSyncedDirectionStates({
    direction: 'client',
    directions: {} as WorkbenchDirectionStates,
    graphs,
    history: initialDirectionHistoryState(graphs),
    viewports,
    selectedNodeIds: [],
    selectedNodeIdsByDirection: emptyDirectionSelections(),
    executionNodeIdsByDirection: clearAllExecution(),
    plugins: [...input.plugins],
    publishedFingerprint: input.publishedFingerprint,
    savedDraftFingerprint: draftFingerprint(graphs, viewports),
    status: { message: 'Ready', kind: 'idle' },
    ui: {
      activeModal: { type: 'none' },
      paletteCollapsed: false,
    },
  });
}

function reduceWorkbenchInner(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  if (action.type === 'directionChanged') {
    return {
      ...state,
      direction: action.direction,
      selectedNodeIds: [...state.selectedNodeIdsByDirection[action.direction]],
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
      },
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

  if (action.type === 'policyNodeAdded') {
    const graph = cloneValue(state.graphs[state.direction]);
    const direction = graphDirection(graph, state.direction);
    const start = graph.nodes.find(isStartNode);
    if (!start) return state;

    const node: PipelineNode = {
      id: `${direction}-node-${nextGraphSerial(graph, `${direction}-node-`)}`,
      type: 'policy',
      policy: action.policy,
      config: defaultConfigForPolicy(action.policy),
      x: action.position.x,
      y: action.position.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      path: [],
    };
    const previousEdge = firstEdgeFromPort(graph, start.id, 'next');

    graph.nodes.push(node);
    graph.edges = graph.edges.filter((edge) => !(edge.from === start.id && edge.fromPort === 'next'));
    graph.edges.push(nextEdge(graph, direction, start.id, 'next', node.id));
    if (previousEdge?.to && previousEdge.to !== node.id) {
      graph.edges.push(
        nextEdge(graph, direction, node.id, 'next', previousEdge.to),
      );
    }

    return {
      ...state,
      ...recordCurrentGraph(state, graph),
      ...updateSelection(state, [node.id]),
      ...updateExecution(state, []),
    };
  }

  if (action.type === 'nodeDeleted') {
    const graph = cloneValue(state.graphs[state.direction]);
    const direction = graphDirection(graph, state.direction);
    const node = findNode(graph, action.nodeId);
    if (!node || isStartNode(node)) return state;
    const incoming = incomingEdge(graph, action.nodeId);
    const outgoing = firstEdgeFromPort(graph, action.nodeId, 'next');
    const reconnect = incoming && outgoing && outgoing.to !== action.nodeId
      ? nextEdge(
        graph,
        direction,
        incoming.from,
        incoming.fromPort ?? 'next',
        outgoing.to,
      )
      : null;

    graph.nodes = graph.nodes.filter((item) => item.id !== action.nodeId);
    graph.edges = graph.edges.filter((edge) => edge.from !== action.nodeId && edge.to !== action.nodeId);
    if (reconnect) graph.edges.push(reconnect);

    if (!validatePipelineGraph(graph).valid) return state;

    return {
      ...state,
      ...recordCurrentGraph(state, graph),
      ...updateSelection(state, []),
      ...updateExecution(state, []),
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
      },
    };
  }

  if (action.type === 'edgeReplaced') {
    if (action.from === action.to) return state;

    const graph = cloneValue(state.graphs[state.direction]);
    const direction = graphDirection(graph, state.direction);
    const from = findNode(graph, action.from);
    const to = findNode(graph, action.to);
    if (!from || !to || isStartNode(to)) return state;

    const existing = firstEdgeFromPort(graph, action.from, action.fromPort);
    if (existing?.to === action.to && existing.toPort === 'in') return state;
    const targetIncoming = incomingEdge(graph, action.to);
    const targetNext = firstEdgeFromPort(graph, action.to, 'next');
    const shouldInsertBeforeExistingTarget = Boolean(
      existing?.to &&
        existing.to !== action.to &&
        !targetIncoming &&
        !targetNext,
    );

    graph.edges = graph.edges.filter((edge) =>
      !(edge.from === action.from && edge.fromPort === action.fromPort) &&
      edge.to !== action.to
    );
    graph.edges.push(nextEdge(
      graph,
      direction,
      action.from,
      action.fromPort,
      action.to,
    ));
    if (shouldInsertBeforeExistingTarget && existing?.to) {
      graph.edges.push(nextEdge(
        graph,
        direction,
        action.to,
        'next',
        existing.to,
      ));
    }

    if (!validatePipelineGraph(graph).valid) return state;

    return {
      ...state,
      ...recordCurrentGraph(state, graph),
      ...updateExecution(state, []),
    };
  }

  if (action.type === 'nodeDoubleClicked') {
    const graph = state.graphs[state.direction];
    const node = findNode(graph, action.nodeId);
    if (!node) return state;

    if (isStartNode(node)) {
      return setActiveModal(state, {
        type: 'playground',
        nodeId: node.id,
      });
    }

    return setActiveModal(state, {
      type: 'settings',
      nodeId: node.id,
      mode: 'interactive',
      json: formatSettingsJson(node.config),
      error: '',
    });
  }

  if (action.type === 'modalClosed') {
    return setActiveModal(state, { type: 'none' });
  }

  if (action.type === 'settingsModeChanged') {
    if (state.ui.activeModal.type !== 'settings') return state;
    return setActiveModal(state, {
      ...state.ui.activeModal,
      mode: action.mode,
    });
  }

  if (action.type === 'settingsJsonChanged') {
    if (state.ui.activeModal.type !== 'settings') return state;
    const parsed = parseSettingsJson(action.value);
    return setActiveModal(state, {
      ...state.ui.activeModal,
      json: action.value,
      error: parsed.ok ? '' : parsed.error,
    });
  }

  if (action.type === 'settingsApplied') {
    if (state.ui.activeModal.type !== 'settings') return state;
    const modal = state.ui.activeModal;
    const parsed = parseSettingsJson(modal.json);
    if (!parsed.ok) {
      return setActiveModal(state, {
        ...modal,
        error: parsed.error,
      });
    }

    const graph = cloneValue(state.graphs[state.direction]);
    const node = findNode(graph, modal.nodeId);
    if (!node) {
      return setActiveModal(state, {
        ...modal,
        error: 'Node not found in the current graph.',
      });
    }

    node.config = parsed.value;

    return {
      ...state,
      ...recordCurrentGraph(state, graph),
      ...updateExecution(state, []),
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
      },
    };
  }

  if (action.type === 'publishModalOpened') {
    return setActiveModal(state, {
      type: 'publish',
      yaml: buildYamlPreview(graphToPipelines(state.graphs)),
    });
  }

  if (action.type === 'publishConfirmed') {
    return setActiveModal(state, { type: 'none' });
  }

  if (action.type === 'initialDataLoaded') {
    const configPipelines = normalizePipelineEntries(action.pipelines);
    const configGraphs = normalizePipelineGraphs(
      pipelinesToGraph(configPipelines) as PipelineGraphsInput,
    );
    const publishedFingerprint = fingerprintPipelines(configPipelines);
    let graphs = configGraphs;
    let viewports = cloneValue(DEFAULT_VIEWPORT);
    let status: WorkbenchStatus = {
      message: 'Loaded active config',
      kind: 'success',
    };

    if (action.draft !== null && action.draft !== undefined) {
      const normalized = normalizeWorkbenchDraft(action.draft);
      if (!('error' in normalized)) {
        graphs = normalizePipelineGraphs(normalized.draft.graphs);
        viewports = normalizeViewports(normalized.draft.viewports);
        status = {
          message: 'Loaded saved DAG',
          kind: 'success',
        };
      }
    }

    return {
      ...state,
      graphs,
      history: initialDirectionHistoryState(graphs),
      viewports,
      selectedNodeIds: [],
      selectedNodeIdsByDirection: emptyDirectionSelections(),
      executionNodeIdsByDirection: clearAllExecution(),
      plugins: sanitizePlugins(action.plugins),
      publishedFingerprint,
      savedDraftFingerprint: draftFingerprint(graphs, viewports),
      status,
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
      },
    };
  }

  if (action.type === 'graphsLoaded') {
    const graphs = normalizePipelineGraphs(action.graphs);
    const viewports = action.viewports === undefined
      ? state.viewports
      : normalizeViewports(action.viewports, state.viewports);

    return {
      ...state,
      graphs,
      history: recordGraphsReplaceHistory(state, graphs),
      viewports,
      selectedNodeIds: [],
      selectedNodeIdsByDirection: emptyDirectionSelections(),
      executionNodeIdsByDirection: clearAllExecution(),
      savedDraftFingerprint: action.savedDraftFingerprint ??
        draftFingerprint(graphs, viewports),
      status: {
        message: action.message,
        kind: 'success',
      },
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
      },
    };
  }

  if (action.type === 'draftSaved') {
    return {
      ...state,
      savedDraftFingerprint: action.savedDraftFingerprint ??
        draftFingerprint(state.graphs, state.viewports),
      status: {
        message: action.message,
        kind: action.kind ?? 'success',
      },
    };
  }

  if (action.type === 'published') {
    const pipelines = normalizePipelineEntries(action.pipelines);
    return {
      ...state,
      publishedFingerprint: fingerprintPipelines(pipelines),
      status: {
        message: action.message ?? 'Pipeline published',
        kind: 'success',
      },
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
      },
    };
  }

  if (action.type === 'loadFailed') {
    return {
      ...state,
      status: {
        message: action.message,
        kind: 'error',
      },
    };
  }

  if (action.type === 'playgroundResultLoaded') {
    if (state.ui.activeModal.type !== 'playground') return state;
    return setActiveModal({
      ...state,
      ...updateExecution(
        state,
        executionNodeIdsFromResult(
          state.graphs[state.direction],
          action.result,
        ),
      ),
      status: {
        message: 'Playground run complete',
        kind: 'success',
      },
    }, {
      ...state.ui.activeModal,
      result: cloneValue(action.result),
      error: undefined,
    });
  }

  if (action.type === 'playgroundFailed') {
    if (state.ui.activeModal.type !== 'playground') {
      return {
        ...state,
        status: {
          message: action.message,
          kind: 'error',
        },
      };
    }
    return setActiveModal({
      ...state,
      status: {
        message: action.message,
        kind: 'error',
      },
    }, {
      ...state.ui.activeModal,
      result: undefined,
      error: action.message,
    });
  }

  if (action.type === 'paletteToggled') {
    return {
      ...state,
      ui: {
        ...state.ui,
        paletteCollapsed: !state.ui.paletteCollapsed,
      },
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
      ...updateExecution(state, []),
      selectedNodeIds: [],
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
      },
    };
  }

  return state;
}

export function reduceWorkbench(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  const next = reduceWorkbenchInner(state, action);
  if (next === state) return state;
  return withSyncedDirectionStates(next);
}
