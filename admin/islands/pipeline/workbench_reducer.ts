import {
  applyHistoryChange,
  dagFingerprintFromGraphs,
  fingerprintPipelines,
  initialDirectionHistoryState,
  normalizeWorkbenchDraft,
  recordDirectionHistorySnapshot,
  recordHistorySnapshot,
} from './workbench_state.js';
import { graphToPipelines, matchExecutionSteps, validatePipelineGraph } from './graph.js';
import { defaultConfigForPolicy, reconcileMatchCaseEdges } from './node_defaults.ts';
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
  Rect,
  WirePreview,
  WorkbenchStatus,
} from './types.ts';

type PipelineGraphsInput = PipelineGraphs | Record<string, PipelineGraph>;
type SettingsMode = 'interactive' | 'json';
type WorkbenchModal =
  | Exclude<ActiveModal, { type: 'playground' } | { type: 'settings' }>
  | {
    type: 'playground';
    nodeId: string | null;
    result?: unknown;
    error?: string;
  }
  | {
    type: 'settings';
    nodeId: string;
    mode: SettingsMode;
    json: string;
    error: string;
    caseIndexMap?: Array<number | null> | null;
  };

interface WorkbenchUiState {
  activeModal: WorkbenchModal;
  paletteCollapsed: boolean;
  marquee: Rect | null;
  wirePreview: WirePreview | null;
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
  | { type: 'directionPreferenceLoaded'; direction: PipelineDirection }
  | { type: 'viewportChanged'; zoom: number; pan: Point }
  | { type: 'nodeSelected'; nodeId: string; additive?: boolean }
  | { type: 'selectionReplaced'; nodeIds: string[] }
  | { type: 'marqueeChanged'; rect: Rect | null }
  | {
    type: 'nodeMoved';
    nodeId: string;
    x: number;
    y: number;
    transient?: boolean;
  }
  | { type: 'nodeDragCommitted'; nodeIds: string[] }
  | { type: 'policyNodeAdded'; policy: string; position: Point }
  | { type: 'nodeDeleted'; nodeId: string }
  | { type: 'edgeReplaced'; from: string; fromPort: string; to: string }
  | { type: 'edgeRemoved'; edgeId: string }
  | { type: 'nodeDoubleClicked'; nodeId: string }
  | { type: 'modalClosed' }
  | { type: 'settingsModeChanged'; mode: SettingsMode }
  | {
    type: 'settingsJsonChanged';
    value: string;
    caseIndexMap?: Array<number | null> | null;
  }
  | { type: 'settingsApplied' }
  | { type: 'publishModalOpened' }
  | { type: 'publishConfirmed' }
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
  | { type: 'palettePreferenceLoaded'; collapsed: boolean }
  | { type: 'wirePreviewChanged'; preview: WirePreview | null }
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

function matchCaseCount(config: unknown): number {
  const record = config !== null && typeof config === 'object' ? config as Record<string, unknown> : {};
  return Array.isArray(record.cases) ? record.cases.length : 0;
}

function initialMatchCaseIndexMap(config: unknown): Array<number | null> {
  return Array.from(
    { length: matchCaseCount(config) },
    (_, index) => index,
  );
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
  options: { publishedFingerprint?: string } = {},
): { draft: any } | { error: string } {
  const errors: string[] = [];
  const drafts: any[] = [];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const normalized = normalizeWorkbenchDraft(candidate);
    if (!('error' in normalized)) {
      drafts.push(normalized.draft);
      continue;
    }
    errors.push(normalized.error);
  }
  if (drafts.length > 0) {
    const sorted = drafts.toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const publishedFingerprint = options.publishedFingerprint;
    const compatible = typeof publishedFingerprint === 'string' && publishedFingerprint.length > 0
      ? sorted.filter((draft) => draft.lastPublishedFingerprint === publishedFingerprint)
      : [];
    return { draft: compatible[0] ?? sorted[0] };
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
    savedDraftFingerprint: dagFingerprintFromGraphs(graphs),
    status: { message: 'Ready', kind: 'idle' },
    ui: {
      activeModal: { type: 'none' },
      paletteCollapsed: false,
      marquee: null,
      wirePreview: null,
    },
  });
}

function reduceWorkbenchInner(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  if (
    action.type === 'directionChanged' ||
    action.type === 'directionPreferenceLoaded'
  ) {
    return {
      ...state,
      direction: action.direction,
      selectedNodeIds: [...state.selectedNodeIdsByDirection[action.direction]],
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
        marquee: null,
        wirePreview: null,
      },
    };
  }

  if (action.type === 'nodeSelected') {
    const graph = state.graphs[state.direction];
    if (!findNode(graph, action.nodeId)) return state;

    const current = new Set(state.selectedNodeIds);
    const next = action.additive
      ? current.has(action.nodeId)
        ? [...current].filter((nodeId) => nodeId !== action.nodeId)
        : [...current, action.nodeId]
      : [action.nodeId];

    return {
      ...state,
      ...updateSelection(state, next),
    };
  }

  if (action.type === 'selectionReplaced') {
    const nodeIds = new Set(state.graphs[state.direction].nodes.map((node) => node.id));
    return {
      ...state,
      ...updateSelection(
        state,
        action.nodeIds.filter((nodeId) => nodeIds.has(nodeId)),
      ),
    };
  }

  if (action.type === 'marqueeChanged') {
    return {
      ...state,
      ui: {
        ...state.ui,
        marquee: action.rect === null ? null : {
          x: action.rect.x,
          y: action.rect.y,
          width: action.rect.width,
          height: action.rect.height,
        },
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
      history: action.transient ? state.history : recordDirectionHistorySnapshot(
        state.history,
        state.direction,
        graph,
      ),
    };
  }

  if (action.type === 'nodeDragCommitted') {
    const graph = state.graphs[state.direction];
    const ids = new Set(action.nodeIds);
    if (!graph.nodes.some((node) => ids.has(node.id))) return state;

    return {
      ...state,
      history: recordDirectionHistorySnapshot(
        state.history,
        state.direction,
        graph,
      ),
      ...updateExecution(state, []),
    };
  }

  if (action.type === 'policyNodeAdded') {
    const graph = cloneValue(state.graphs[state.direction]);
    const direction = graphDirection(graph, state.direction);

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

    graph.nodes.push(node);

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
        marquee: null,
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
      ui: {
        ...state.ui,
        wirePreview: null,
      },
    };
  }

  if (action.type === 'edgeRemoved') {
    const graph = cloneValue(state.graphs[state.direction]);
    if (!graph.edges.some((edge) => edge.id === action.edgeId)) return state;
    graph.edges = graph.edges.filter((edge) => edge.id !== action.edgeId);

    return {
      ...state,
      ...recordCurrentGraph(state, graph),
      ...updateExecution(state, []),
      ui: {
        ...state.ui,
        wirePreview: null,
      },
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

    const modal: WorkbenchModal = {
      type: 'settings',
      nodeId: node.id,
      mode: 'interactive',
      json: formatSettingsJson(node.config),
      error: '',
    };

    return setActiveModal(
      state,
      node.policy === 'match' ? { ...modal, caseIndexMap: initialMatchCaseIndexMap(node.config) } : modal,
    );
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
      caseIndexMap: action.caseIndexMap === undefined ? null : action.caseIndexMap,
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
    if (node.policy === 'match') {
      const caseIndexMap = modal.caseIndexMap === undefined
        ? initialMatchCaseIndexMap(node.config)
        : modal.caseIndexMap;
      graph.edges = reconcileMatchCaseEdges(
        graph.edges,
        node.id,
        caseIndexMap,
        matchCaseCount(parsed.value),
      );
    }

    return {
      ...state,
      ...recordCurrentGraph(state, graph),
      ...updateExecution(state, []),
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
        marquee: null,
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
        dagFingerprintFromGraphs(graphs),
      status: {
        message: action.message,
        kind: 'success',
      },
      ui: {
        ...state.ui,
        activeModal: { type: 'none' },
        wirePreview: null,
      },
    };
  }

  if (action.type === 'draftSaved') {
    return {
      ...state,
      savedDraftFingerprint: action.savedDraftFingerprint ??
        dagFingerprintFromGraphs(state.graphs),
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

  if (action.type === 'palettePreferenceLoaded') {
    return {
      ...state,
      ui: {
        ...state.ui,
        paletteCollapsed: action.collapsed,
      },
    };
  }

  if (action.type === 'wirePreviewChanged') {
    return {
      ...state,
      ui: {
        ...state.ui,
        wirePreview: action.preview === null ? null : {
          from: action.preview.from,
          fromPort: action.preview.fromPort,
          point: {
            x: action.preview.point.x,
            y: action.preview.point.y,
          },
        },
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
