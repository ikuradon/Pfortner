export const WORKBENCH_DRAFT_VERSION = 1;
export const LOCAL_DRAFT_KEY = 'pfortner.pipelineWorkbenchDraft.v1';
export const PALETTE_COLLAPSED_KEY = 'pfortner.pipelinePaletteCollapsed.v1';
export const LAST_DIRECTION_KEY = 'pfortner.pipelineDirection.v1';

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function fingerprintPipelines(pipelines) {
  return JSON.stringify(stableValue({
    client: Array.isArray(pipelines?.client) ? pipelines.client : [],
    server: Array.isArray(pipelines?.server) ? pipelines.server : [],
  }));
}

export function dagFingerprintFromGraphs(graphs) {
  return JSON.stringify(stableValue({
    client: graphs?.client ?? { direction: 'client', nodes: [], edges: [] },
    server: graphs?.server ?? { direction: 'server', nodes: [], edges: [] },
  }));
}

export function initialHistoryState(initialGraphs) {
  return { past: [], present: cloneValue(initialGraphs), future: [] };
}

export function initialDirectionHistoryState(graphs) {
  return {
    client: initialHistoryState(graphs?.client ?? { direction: 'client', nodes: [], edges: [] }),
    server: initialHistoryState(graphs?.server ?? { direction: 'server', nodes: [], edges: [] }),
  };
}

export function recordHistorySnapshot(history, nextGraphs) {
  const next = cloneValue(nextGraphs);
  if (
    JSON.stringify(stableValue(history.present)) ===
      JSON.stringify(stableValue(next))
  ) {
    return history;
  }
  return {
    past: history.past.concat([cloneValue(history.present)]).slice(-100),
    present: next,
    future: [],
  };
}

export function recordDirectionHistorySnapshot(histories, direction, nextGraph) {
  if (direction !== 'client' && direction !== 'server') return histories;
  return {
    ...histories,
    [direction]: recordHistorySnapshot(histories[direction], nextGraph),
  };
}

export function applyHistoryChange(history, direction) {
  if (direction === 'undo') {
    if (history.past.length === 0) return history;
    const previous = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      present: cloneValue(previous),
      future: [cloneValue(history.present)].concat(history.future),
    };
  }
  if (direction === 'redo') {
    if (history.future.length === 0) return history;
    const next = history.future[0];
    return {
      past: history.past.concat([cloneValue(history.present)]),
      present: cloneValue(next),
      future: history.future.slice(1),
    };
  }
  return history;
}

export function isUndoAvailable(history) {
  return Array.isArray(history?.past) && history.past.length > 0;
}

export function isRedoAvailable(history) {
  return Array.isArray(history?.future) && history.future.length > 0;
}

/**
 * @param {{ graphs: any, viewports: any, publishedFingerprint: string, now?: number | string | Date }} options
 */
export function buildPipelineDraft({ graphs, viewports, publishedFingerprint, now }) {
  return {
    version: WORKBENCH_DRAFT_VERSION,
    graphs: cloneValue(graphs),
    viewports: cloneValue(viewports),
    updatedAt: formatExplicitTimestamp(now),
    lastPublishedFingerprint: publishedFingerprint,
  };
}

function formatExplicitTimestamp(value) {
  if (
    typeof value !== 'number' && typeof value !== 'string' &&
    !(value instanceof Date)
  ) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGraph(graph, direction) {
  if (!isRecord(graph)) {
    return { error: `${direction} graph must be an object` };
  }
  if (!Array.isArray(graph.nodes)) {
    return { error: `${direction}.nodes must be an array` };
  }
  if (!Array.isArray(graph.edges)) {
    return { error: `${direction}.edges must be an array` };
  }
  return {
    graph: {
      direction,
      nodes: cloneValue(graph.nodes),
      edges: cloneValue(graph.edges),
    },
  };
}

/**
 * @returns {{ error: string } | { draft: {
 *   version: number,
 *   graphs: { client: any, server: any },
 *   viewports: any,
 *   updatedAt: string,
 *   lastPublishedFingerprint: string,
 * } }}
 */
export function normalizeWorkbenchDraft(value) {
  if (!isRecord(value)) return { error: 'draft object required' };
  if (value.version !== WORKBENCH_DRAFT_VERSION) {
    return { error: 'unsupported draft version' };
  }
  if (!isRecord(value.graphs)) return { error: 'draft.graphs object required' };
  const client = normalizeGraph(value.graphs.client, 'client');
  if ('error' in client) return client;
  const server = normalizeGraph(value.graphs.server, 'server');
  if ('error' in server) return server;
  return {
    draft: {
      version: WORKBENCH_DRAFT_VERSION,
      graphs: { client: client.graph, server: server.graph },
      viewports: isRecord(value.viewports) ? cloneValue(value.viewports) : {},
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
      lastPublishedFingerprint: typeof value.lastPublishedFingerprint === 'string'
        ? value.lastPublishedFingerprint
        : '',
    },
  };
}

export function hasUnpublishedChanges(
  currentFingerprint,
  publishedFingerprint,
) {
  return currentFingerprint !== publishedFingerprint;
}

export function getWorkbenchChangeState({
  currentDraftFingerprint,
  savedDraftFingerprint,
  currentPipelineFingerprint,
  publishedFingerprint,
}) {
  const hasUnsavedDagChanges = currentDraftFingerprint !== savedDraftFingerprint;
  const hasUnpublishedChanges = currentPipelineFingerprint !== publishedFingerprint;
  return {
    hasUnsavedDagChanges,
    hasUnpublishedChanges,
    dagLabel: hasUnsavedDagChanges ? 'Unsaved DAG' : 'Saved DAG',
    publishLabel: hasUnpublishedChanges ? 'Unpublished changes' : 'Published',
  };
}
