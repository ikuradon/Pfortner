import { assertEquals, assertMatch, assertStrictEquals } from '@std/assert';
import { graphToPipelines, pipelinesToGraph, validatePipelineGraph } from './graph.js';
import {
  buildPipelineDraft,
  dagFingerprintFromGraphs,
  fingerprintPipelines,
  getWorkbenchChangeState,
} from './workbench_state.js';
import { evaluatePipeline } from './api_client.ts';
import {
  createInitialWorkbenchState,
  reduceWorkbench,
  selectWorkbenchDraft,
  validateWorkbenchGraphsForPublish,
} from './workbench_reducer.ts';

type PipelineNodeForTest = {
  id: string;
  policy?: string;
  config?: unknown;
  x?: number;
  y?: number;
};

type PipelineEntryForTest = {
  policy: string;
  config?: unknown;
};

function policyNode(
  state: ReturnType<typeof createInitialWorkbenchState>,
  direction: 'client' | 'server',
  policy: string,
): PipelineNodeForTest {
  return state.graphs[direction].nodes.find((item) => item.policy === policy)!;
}

function nodeById(
  state: ReturnType<typeof createInitialWorkbenchState>,
  direction: 'client' | 'server',
  nodeId: string,
): PipelineNodeForTest {
  return state.graphs[direction].nodes.find((item) => item.id === nodeId)!;
}

function addStandalonePolicyNode(
  graphs: ReturnType<typeof pipelinesToGraph>,
  direction: 'client' | 'server',
  policy: string,
  id: string,
) {
  graphs[direction].nodes.push({
    id,
    type: 'policy',
    policy,
    config: {},
    x: 480,
    y: 112,
    width: 180,
    height: 72,
    path: [],
  });
}

function settingsModal(
  state: ReturnType<typeof createInitialWorkbenchState>,
) {
  const modal = state.ui.activeModal;
  if (modal.type !== 'settings') {
    throw new Error(`Expected settings modal, got ${modal.type}`);
  }
  return modal;
}

function publishModal(
  state: ReturnType<typeof createInitialWorkbenchState>,
) {
  const modal = state.ui.activeModal;
  if (modal.type !== 'publish') {
    throw new Error(`Expected publish modal, got ${modal.type}`);
  }
  return modal;
}

function playgroundModal(
  state: ReturnType<typeof createInitialWorkbenchState>,
) {
  const modal = state.ui.activeModal;
  if (modal.type !== 'playground') {
    throw new Error(`Expected playground modal, got ${modal.type}`);
  }
  return modal;
}

function setGlobalValue(name: string, value: unknown): () => void {
  const target = globalThis as Record<string, unknown>;
  const hadValue = Object.prototype.hasOwnProperty.call(target, name);
  const previousValue = target[name];

  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
  });

  return () => {
    if (hadValue) {
      Object.defineProperty(globalThis, name, {
        value: previousValue,
        configurable: true,
      });
    } else {
      delete target[name];
    }
  };
}

Deno.test('workbench reducer switches direction and preserves viewport', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });

  state = reduceWorkbench(state, {
    type: 'viewportChanged',
    zoom: 1.4,
    pan: { x: 20, y: 30 },
  });
  state = reduceWorkbench(state, {
    type: 'directionChanged',
    direction: 'server',
  });

  assertEquals(state.direction, 'server');
  assertEquals(state.viewports.client.zoom, 1.4);
  assertEquals(state.viewports.client.pan, { x: 20, y: 30 });
});

Deno.test('workbench reducer does not mark DAG unsaved for viewport-only pan changes', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: fingerprintPipelines(graphToPipelines(graphs)),
  });

  const panned = reduceWorkbench(state, {
    type: 'viewportChanged',
    zoom: 1,
    pan: { x: 120, y: 160 },
  });
  const changeState = getWorkbenchChangeState({
    currentDraftFingerprint: dagFingerprintFromGraphs(panned.graphs),
    savedDraftFingerprint: panned.savedDraftFingerprint,
    currentPipelineFingerprint: fingerprintPipelines(graphToPipelines(panned.graphs)),
    publishedFingerprint: panned.publishedFingerprint,
  });

  assertEquals(changeState.hasUnsavedDagChanges, false);
  assertEquals(changeState.dagLabel, 'Saved DAG');
});

Deno.test('workbench reducer can load persisted palette collapsed state', () => {
  const state = createInitialWorkbenchState({
    graphs: pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] }),
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });

  const next = reduceWorkbench(state, {
    type: 'palettePreferenceLoaded',
    collapsed: true,
  });

  assertEquals(next.ui.paletteCollapsed, true);
});

Deno.test('workbench reducer can load persisted direction', () => {
  const state = createInitialWorkbenchState({
    graphs: pipelinesToGraph({
      client: [{ policy: 'accept' }],
      server: [{ policy: 'write-guard' }],
    }),
    plugins: ['accept', 'write-guard'],
    publishedFingerprint: 'fp',
  });

  const next = reduceWorkbench(state, {
    type: 'directionPreferenceLoaded',
    direction: 'server',
  });

  assertEquals(next.direction, 'server');
  assertEquals(next.selectedNodeIds, []);
});

Deno.test('workbench reducer initializes direction-scoped selections', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });

  assertEquals(state.selectedNodeIds, []);
  assertEquals(state.selectedNodeIdsByDirection, {
    client: [],
    server: [],
  });
});

Deno.test('workbench reducer switches selected nodes with direction', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  const state = {
    ...createInitialWorkbenchState({
      graphs,
      plugins: ['accept'],
      publishedFingerprint: 'fp',
    }),
    selectedNodeIds: ['client-node-1'],
    selectedNodeIdsByDirection: {
      client: ['client-node-1'],
      server: ['server-node-1'],
    },
  };

  const next = reduceWorkbench(state, {
    type: 'directionChanged',
    direction: 'server',
  });

  assertEquals(next.direction, 'server');
  assertEquals(next.selectedNodeIds, ['server-node-1']);
  assertEquals(next.selectedNodeIdsByDirection.client, ['client-node-1']);
});

Deno.test('workbench reducer selects nodes in the active direction', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }, { policy: 'rate-limit' }],
    server: [{ policy: 'write-guard' }],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const accept = policyNode(state, 'client', 'accept');
  const rateLimit = policyNode(state, 'client', 'rate-limit');

  state = reduceWorkbench(state, {
    type: 'nodeSelected',
    nodeId: accept.id,
    additive: false,
  });
  state = reduceWorkbench(state, {
    type: 'nodeSelected',
    nodeId: rateLimit.id,
    additive: true,
  });
  state = reduceWorkbench(state, {
    type: 'selectionReplaced',
    nodeIds: [rateLimit.id],
  });
  state = reduceWorkbench(state, {
    type: 'directionChanged',
    direction: 'server',
  });

  assertEquals(state.selectedNodeIdsByDirection.client, [rateLimit.id]);
  assertEquals(state.selectedNodeIds, []);
});

Deno.test('workbench reducer tracks marquee rectangle in UI state', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });

  state = reduceWorkbench(state, {
    type: 'marqueeChanged',
    rect: { x: 10, y: 20, width: 120, height: 80 },
  });
  assertEquals(state.ui.marquee, { x: 10, y: 20, width: 120, height: 80 });

  state = reduceWorkbench(state, { type: 'marqueeChanged', rect: null });
  assertEquals(state.ui.marquee, null);
});

Deno.test('workbench reducer closes modal when direction changes', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, {
    type: 'directionChanged',
    direction: 'server',
  });

  assertEquals(state.direction, 'server');
  assertEquals(state.ui.activeModal, { type: 'none' });
});

Deno.test('workbench reducer keeps selection and identity on no-op history changes', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  const state = {
    ...createInitialWorkbenchState({
      graphs,
      plugins: ['accept'],
      publishedFingerprint: 'fp',
    }),
    selectedNodeIds: ['client-node-1'],
    selectedNodeIdsByDirection: {
      client: ['client-node-1'],
      server: ['server-node-1'],
    },
  };

  const undone = reduceWorkbench(state, { type: 'undo' });
  const redone = reduceWorkbench(state, { type: 'redo' });

  assertStrictEquals(undone, state);
  assertStrictEquals(redone, state);
  assertEquals(state.selectedNodeIds, ['client-node-1']);
  assertEquals(state.selectedNodeIdsByDirection.server, ['server-node-1']);
});

Deno.test('workbench reducer records node move as undoable action', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');
  const previousX = node.x;
  const previousY = node.y;
  const previousState = state;

  const moved = reduceWorkbench(state, {
    type: 'nodeMoved',
    nodeId: node.id,
    x: 160,
    y: 96,
  });
  state = reduceWorkbench(moved, { type: 'undo' });

  const reverted = nodeById(state, 'client', node.id);
  assertEquals(reverted.x, previousX);
  assertEquals(reverted.y, previousY);
  assertEquals(nodeById(previousState, 'client', node.id).x, previousX);
  assertEquals(nodeById(previousState, 'client', node.id).y, previousY);
  assertEquals(nodeById(moved, 'client', node.id).x, 160);
  assertEquals(nodeById(moved, 'client', node.id).y, 96);
});

Deno.test('workbench reducer commits node drag history once on pointer up', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');

  state = reduceWorkbench(state, {
    type: 'nodeMoved',
    nodeId: node.id,
    x: 180,
    y: 96,
    transient: true,
  });
  state = reduceWorkbench(state, {
    type: 'nodeMoved',
    nodeId: node.id,
    x: 220,
    y: 124,
    transient: true,
  });
  state = reduceWorkbench(state, {
    type: 'nodeDragCommitted',
    nodeIds: [node.id],
  });

  assertEquals(nodeById(state, 'client', node.id).x, 220);
  assertEquals(nodeById(state, 'client', node.id).y, 124);
  assertEquals(state.history.client.past.length, 1);

  state = reduceWorkbench(state, { type: 'undo' });
  assertEquals(nodeById(state, 'client', node.id).x, node.x);
  assertEquals(nodeById(state, 'client', node.id).y, node.y);
});

Deno.test('workbench reducer opens settings modal when policy node is double clicked', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'write-guard', config: { require_auth: true } }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['write-guard'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'write-guard');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });

  assertEquals(settingsModal(state), {
    type: 'settings',
    nodeId: node.id,
    mode: 'interactive',
    json: JSON.stringify({ require_auth: true }, null, 2),
    error: '',
  });
});

Deno.test('workbench reducer opens playground modal when start node is double clicked', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const start = policyNode(state, 'client', 'start');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: start.id,
  });

  assertEquals(state.ui.activeModal, {
    type: 'playground',
    nodeId: start.id,
  });
});

Deno.test('workbench reducer closes active modal', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, { type: 'modalClosed' });

  assertEquals(state.ui.activeModal, { type: 'none' });
});

Deno.test('workbench reducer updates settings JSON and reports parse errors', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');
  const validJson = JSON.stringify({ enabled: true }, null, 2);

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, {
    type: 'settingsModeChanged',
    mode: 'json',
  });
  state = reduceWorkbench(state, {
    type: 'settingsJsonChanged',
    value: validJson,
  });

  assertEquals(settingsModal(state).mode, 'json');
  assertEquals(settingsModal(state).json, validJson);
  assertEquals(settingsModal(state).error, '');

  state = reduceWorkbench(state, {
    type: 'settingsJsonChanged',
    value: '{',
  });

  assertEquals(settingsModal(state).json, '{');
  assertMatch(settingsModal(state).error, /Invalid JSON/);
});

Deno.test('workbench reducer applies valid settings JSON to the graph and records history', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'write-guard', config: { require_auth: true } }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['write-guard'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'write-guard');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, {
    type: 'settingsJsonChanged',
    value: JSON.stringify({ require_auth: false, note: 'ok' }, null, 2),
  });
  const previousHistoryLength = state.history.client.past.length;

  state = reduceWorkbench(state, { type: 'settingsApplied' });

  assertEquals(nodeById(state, 'client', node.id).config, {
    require_auth: false,
    note: 'ok',
  });
  assertEquals(state.history.client.past.length, previousHistoryLength + 1);
  assertEquals(state.ui.activeModal, { type: 'none' });
});

Deno.test('workbench reducer reconciles match case edges when settings remove a case', () => {
  const graphs = pipelinesToGraph({
    client: [{
      policy: 'match',
      config: {
        cases: [
          { condition: { kind: 1 }, pipeline: [{ policy: 'accept' }] },
          { condition: { kind: 2 }, pipeline: [{ policy: 'write-guard' }] },
        ],
        default: [],
      },
    }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['match', 'accept', 'write-guard'],
    publishedFingerprint: 'fp',
  });
  const matchNode = policyNode(state, 'client', 'match');
  const secondCaseEdge = state.graphs.client.edges.find((edge) =>
    edge.from === matchNode.id && edge.fromPort === 'case:1'
  );
  if (!secondCaseEdge) throw new Error('Expected second case edge');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: matchNode.id,
  });
  state = reduceWorkbench(state, {
    type: 'settingsJsonChanged',
    value: JSON.stringify(
      {
        cases: [
          { condition: { kind: 2 }, pipeline: [{ policy: 'write-guard' }] },
        ],
        default: [],
      },
      null,
      2,
    ),
    caseIndexMap: [1],
  });
  state = reduceWorkbench(state, { type: 'settingsApplied' });

  assertEquals(
    state.graphs.client.edges.some((edge) =>
      edge.from === matchNode.id &&
      edge.fromPort === 'case:0' &&
      edge.to === secondCaseEdge.to
    ),
    true,
  );
  assertEquals(
    state.graphs.client.edges.some((edge) => edge.from === matchNode.id && edge.fromPort === 'case:1'),
    false,
  );
});

Deno.test('workbench reducer keeps settings modal open for invalid JSON apply', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'write-guard', config: { require_auth: true } }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['write-guard'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'write-guard');
  const previousHistoryLength = state.history.client.past.length;

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, {
    type: 'settingsJsonChanged',
    value: '{',
  });
  state = reduceWorkbench(state, { type: 'settingsApplied' });

  assertEquals(nodeById(state, 'client', node.id).config, {
    require_auth: true,
  });
  assertEquals(state.history.client.past.length, previousHistoryLength);
  assertEquals(settingsModal(state).nodeId, node.id);
  assertMatch(settingsModal(state).error, /Invalid JSON/);
});

Deno.test('workbench reducer rejects non-object settings JSON values', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'write-guard', config: { require_auth: true } }],
    server: [],
  });

  for (const value of ['[]', 'null', '"x"', '1']) {
    let state = createInitialWorkbenchState({
      graphs,
      plugins: ['write-guard'],
      publishedFingerprint: 'fp',
    });
    const node = policyNode(state, 'client', 'write-guard');

    state = reduceWorkbench(state, {
      type: 'nodeDoubleClicked',
      nodeId: node.id,
    });
    state = reduceWorkbench(state, {
      type: 'settingsJsonChanged',
      value,
    });
    state = reduceWorkbench(state, { type: 'settingsApplied' });

    assertEquals(nodeById(state, 'client', node.id).config, {
      require_auth: true,
    });
    assertEquals(settingsModal(state).nodeId, node.id);
    assertMatch(settingsModal(state).error, /Config JSON must be an object/);
  }
});

Deno.test('workbench reducer opens publish modal with YAML preview', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'write-guard', config: { require_auth: true } }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['write-guard'],
    publishedFingerprint: 'fp',
  });

  state = reduceWorkbench(state, { type: 'publishModalOpened' });

  assertMatch(publishModal(state).yaml, /pipelines:/);
  assertMatch(publishModal(state).yaml, /write-guard/);
  assertMatch(publishModal(state).yaml, /require_auth: true/);
});

Deno.test('workbench reducer loads saved draft as undoable replace', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  const nextGraphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });

  state = reduceWorkbench(state, {
    type: 'graphsLoaded',
    graphs: nextGraphs,
    message: 'Loaded saved DAG',
  });

  assertEquals(
    state.graphs.client.nodes.some((node) => node.policy === 'accept'),
    true,
  );
  assertEquals(state.status, {
    message: 'Loaded saved DAG',
    kind: 'success',
  });

  state = reduceWorkbench(state, { type: 'undo' });

  assertEquals(
    state.graphs.client.nodes.some((node) => node.policy === 'accept'),
    false,
  );
});

Deno.test('workbench draft selection falls back to local draft when server draft is invalid', () => {
  const localDraft = buildPipelineDraft({
    graphs: pipelinesToGraph({
      client: [{ policy: 'accept' }],
      server: [],
    }),
    viewports: {
      client: { zoom: 1, pan: { x: 0, y: 0 } },
      server: { zoom: 1, pan: { x: 0, y: 0 } },
    },
    publishedFingerprint: '',
    now: 1,
  });

  const selected = selectWorkbenchDraft([
    { version: 1, graphs: { client: null, server: null } },
    localDraft,
  ]);

  if ('error' in selected) throw new Error(selected.error);
  assertEquals(
    selected.draft.graphs.client.nodes.some((node: any) => node.policy === 'accept'),
    true,
  );
});

Deno.test('workbench draft selection prefers newest draft compatible with published fingerprint', () => {
  const compatibleOld = buildPipelineDraft({
    graphs: pipelinesToGraph({
      client: [{ policy: 'accept' }],
      server: [],
    }),
    viewports: {
      client: { zoom: 1, pan: { x: 1, y: 1 } },
      server: { zoom: 1, pan: { x: 0, y: 0 } },
    },
    publishedFingerprint: 'published-a',
    now: '2026-01-01T00:00:00.000Z',
  });
  const incompatibleNew = buildPipelineDraft({
    graphs: pipelinesToGraph({
      client: [{ policy: 'rate-limit' }],
      server: [],
    }),
    viewports: {
      client: { zoom: 1, pan: { x: 2, y: 2 } },
      server: { zoom: 1, pan: { x: 0, y: 0 } },
    },
    publishedFingerprint: 'published-b',
    now: '2026-02-01T00:00:00.000Z',
  });
  const compatibleNew = buildPipelineDraft({
    graphs: pipelinesToGraph({
      client: [{ policy: 'write-guard' }],
      server: [],
    }),
    viewports: {
      client: { zoom: 1, pan: { x: 3, y: 3 } },
      server: { zoom: 1, pan: { x: 0, y: 0 } },
    },
    publishedFingerprint: 'published-a',
    now: '2026-03-01T00:00:00.000Z',
  });

  const selected = selectWorkbenchDraft(
    [compatibleOld, incompatibleNew, compatibleNew],
    { publishedFingerprint: 'published-a' },
  );

  if ('error' in selected) throw new Error(selected.error);
  assertEquals(
    selected.draft.graphs.client.nodes.some((node: any) => node.policy === 'write-guard'),
    true,
  );
});

Deno.test('workbench publish validation reports invalid direction before API publish', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  graphs.server.nodes = [];

  assertMatch(
    validateWorkbenchGraphsForPublish(graphs),
    /server graph is invalid/,
  );
});

Deno.test('workbench reducer records draft save status and fingerprint', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const next = reduceWorkbench(state, {
    type: 'draftSaved',
    message: 'DAG saved',
    kind: 'success',
    savedDraftFingerprint: 'draft-fp',
  });

  assertEquals(next.status, {
    message: 'DAG saved',
    kind: 'success',
  });
  assertEquals(next.savedDraftFingerprint, 'draft-fp');
});

Deno.test('workbench reducer publishes response pipelines without replacing DAG layout', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard', 'rate-limit'],
    publishedFingerprint: 'old-fp',
  });
  const nodeId = policyNode(state, 'client', 'accept').id;
  const originalX = policyNode(state, 'client', 'accept').x;

  state = reduceWorkbench(state, {
    type: 'nodeMoved',
    nodeId,
    x: 432,
    y: 96,
  });
  const responsePipelines = graphToPipelines(state.graphs);

  state = reduceWorkbench(state, { type: 'publishModalOpened' });
  state = reduceWorkbench(state, {
    type: 'published',
    pipelines: responsePipelines,
    message: 'Pipeline published',
  });

  assertEquals(graphToPipelines(state.graphs), responsePipelines);
  assertEquals(policyNode(state, 'client', 'accept').x, 432);
  assertEquals(
    state.publishedFingerprint,
    fingerprintPipelines(responsePipelines),
  );
  assertEquals(state.ui.activeModal, { type: 'none' });
  assertEquals(state.status, {
    message: 'Pipeline published',
    kind: 'success',
  });

  const undone = reduceWorkbench(state, { type: 'undo' });
  assertEquals(policyNode(undone, 'client', 'accept').x, originalX);
});

Deno.test('workbench reducer stores load failures as error status', () => {
  const state = createInitialWorkbenchState({
    graphs: pipelinesToGraph({ client: [], server: [] }),
    plugins: [],
    publishedFingerprint: 'fp',
  });
  const next = reduceWorkbench(state, {
    type: 'loadFailed',
    message: 'Draft load failed',
  });

  assertEquals(next.status, {
    message: 'Draft load failed',
    kind: 'error',
  });
});

Deno.test('workbench reducer stores playground result and errors in the active modal', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const start = policyNode(state, 'client', 'start');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: start.id,
  });
  state = reduceWorkbench(state, {
    type: 'playgroundResultLoaded',
    result: { finalAction: 'accept' },
  });

  assertEquals(playgroundModal(state).nodeId, start.id);
  assertEquals(playgroundModal(state).result, { finalAction: 'accept' });
  assertEquals(playgroundModal(state).error, undefined);

  state = reduceWorkbench(state, {
    type: 'playgroundFailed',
    message: 'Message must be a JSON array.',
  });

  assertEquals(playgroundModal(state).nodeId, start.id);
  assertEquals(playgroundModal(state).result, undefined);
  assertEquals(playgroundModal(state).error, 'Message must be a JSON array.');
});

Deno.test('workbench reducer scopes playground execution nodes per direction', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [{ policy: 'write-guard' }],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard'],
    publishedFingerprint: 'fp',
  });
  const clientStart = policyNode(state, 'client', 'start');
  const clientNode = policyNode(state, 'client', 'accept');
  const serverStart = policyNode(state, 'server', 'start');
  const serverNode = policyNode(state, 'server', 'write-guard');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: clientStart.id,
  });
  state = reduceWorkbench(state, {
    type: 'playgroundResultLoaded',
    result: { steps: [{ policy: 'accept', action: 'accept' }] },
  });

  assertEquals(state.directions.client.executionNodeIds, [clientNode.id]);
  assertEquals(state.directions.server.executionNodeIds, []);

  state = reduceWorkbench(state, {
    type: 'directionChanged',
    direction: 'server',
  });
  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: serverStart.id,
  });
  state = reduceWorkbench(state, {
    type: 'playgroundResultLoaded',
    result: { steps: [{ policy: 'write-guard', action: 'next' }] },
  });

  assertEquals(state.directions.client.executionNodeIds, [clientNode.id]);
  assertEquals(state.directions.server.executionNodeIds, [serverNode.id]);
});

Deno.test('pipeline API client posts playground evaluation payload', async () => {
  const fetchCalls: Array<{
    url: string;
    init: RequestInit;
    body: unknown;
  }> = [];
  const restoreFetch = setGlobalValue('fetch', (url: string, init: RequestInit = {}) => {
    fetchCalls.push({
      url,
      init,
      body: JSON.parse(String(init.body ?? '{}')),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ finalAction: 'accept' }), { status: 200 }),
    );
  });

  try {
    const payload = {
      pipeline: [{ policy: 'accept' }],
      message: ['EVENT', { id: '1' }],
      direction: 'client',
      connectionInfo: {},
    };
    const result = await evaluatePipeline(payload);

    assertEquals(fetchCalls.length, 1);
    assertEquals(fetchCalls[0].url, '/admin/api/playground/evaluate');
    assertEquals(fetchCalls[0].init.method, 'POST');
    assertEquals(fetchCalls[0].body, payload);
    assertEquals(result, { finalAction: 'accept' });
  } finally {
    restoreFetch();
  }
});

Deno.test('workbench reducer redoes an undone node move', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');

  state = reduceWorkbench(state, {
    type: 'nodeMoved',
    nodeId: node.id,
    x: 160,
    y: 96,
  });
  state = reduceWorkbench(state, { type: 'undo' });
  state = reduceWorkbench(state, { type: 'redo' });

  const redone = nodeById(state, 'client', node.id);
  assertEquals(redone.x, 160);
  assertEquals(redone.y, 96);
});

Deno.test('workbench reducer scopes server move history away from client graph', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [{ policy: 'write-guard' }],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard'],
    publishedFingerprint: 'fp',
  });
  const clientNode = policyNode(state, 'client', 'accept');
  const clientX = clientNode.x;
  const clientY = clientNode.y;
  const clientHistory = state.history.client;

  state = reduceWorkbench(state, {
    type: 'directionChanged',
    direction: 'server',
  });
  const serverNode = policyNode(state, 'server', 'write-guard');
  state = reduceWorkbench(state, {
    type: 'nodeMoved',
    nodeId: serverNode.id,
    x: 208,
    y: 144,
  });

  assertEquals(nodeById(state, 'client', clientNode.id).x, clientX);
  assertEquals(nodeById(state, 'client', clientNode.id).y, clientY);
  assertStrictEquals(state.history.client, clientHistory);
  assertEquals(state.history.client.past.length, 0);
  assertEquals(state.history.server.past.length, 1);
});

Deno.test('workbench reducer adds a standalone policy node in current direction', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const initialEdges = state.graphs.client.edges;

  const next = reduceWorkbench(state, {
    type: 'policyNodeAdded',
    policy: 'accept',
    position: { x: 160, y: 80 },
  });

  const added = policyNode(next, 'client', 'accept');
  assertEquals(added.id, 'client-node-1');
  assertEquals(added.x, 160);
  assertEquals(added.y, 80);
  assertEquals(next.graphs.client.edges, initialEdges);
  assertEquals(next.selectedNodeIds, [added.id]);
});

Deno.test('workbench reducer adds policy nodes as standalone blocks without auto-connecting', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'rate-limit'],
    publishedFingerprint: 'fp',
  });
  const initialEdges = state.graphs.client.edges;

  const next = reduceWorkbench(state, {
    type: 'policyNodeAdded',
    policy: 'rate-limit',
    position: { x: 520, y: 160 },
  });

  const added = policyNode(next, 'client', 'rate-limit');
  assertEquals(added.id, 'client-node-2');
  assertEquals(added.x, 520);
  assertEquals(added.y, 160);
  assertEquals(next.graphs.client.edges, initialEdges);
});

Deno.test('workbench reducer deletes node with connected edges and clears selection', () => {
  const graphs = pipelinesToGraph({
    client: [
      { policy: 'accept' },
      { policy: 'write-guard', config: { require_auth: true } },
    ],
    server: [],
  });
  const state = {
    ...createInitialWorkbenchState({
      graphs,
      plugins: ['accept', 'write-guard'],
      publishedFingerprint: 'fp',
    }),
    selectedNodeIds: ['client-node-1'],
    selectedNodeIdsByDirection: {
      client: ['client-node-1'],
      server: [],
    },
  };

  const next = reduceWorkbench(state, {
    type: 'nodeDeleted',
    nodeId: 'client-node-1',
  });

  assertEquals(
    next.graphs.client.nodes.some((node) => node.id === 'client-node-1'),
    false,
  );
  assertEquals(
    next.graphs.client.edges.some((edge) => edge.from === 'client-node-1' || edge.to === 'client-node-1'),
    false,
  );
  assertEquals(validatePipelineGraph(next.graphs.client).valid, true);
  const serialized = graphToPipelines(next.graphs)
    .client as PipelineEntryForTest[];
  assertEquals(serialized, [
    {
      policy: 'write-guard',
      config: { require_auth: true },
    },
  ]);
  assertEquals(next.selectedNodeIds, []);
  assertEquals(next.selectedNodeIdsByDirection.client, []);
});

Deno.test('workbench reducer closes modal when active node is deleted', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }, { policy: 'write-guard' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, {
    type: 'nodeDeleted',
    nodeId: node.id,
  });

  assertEquals(state.graphs.client.nodes.some((item) => item.id === node.id), false);
  assertEquals(state.ui.activeModal, { type: 'none' });
});

Deno.test('workbench reducer rejects branch node deletion that would orphan descendants', () => {
  const graphs = pipelinesToGraph({
    client: [
      {
        policy: 'when',
        config: {
          condition: { authenticated: true },
          then: [{ policy: 'accept' }],
          else: [],
        },
      },
      { policy: 'write-guard' },
    ],
    server: [],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'when', 'write-guard'],
    publishedFingerprint: 'fp',
  });

  const rejected = reduceWorkbench(state, {
    type: 'nodeDeleted',
    nodeId: 'client-node-1',
  });

  assertEquals(validatePipelineGraph(state.graphs.client).valid, true);
  assertStrictEquals(rejected, state);
});

Deno.test('workbench reducer replaces edge from the same port by inserting a standalone node', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }, { policy: 'write-guard' }],
    server: [],
  });
  addStandalonePolicyNode(graphs, 'client', 'rate-limit', 'client-node-3');
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard', 'rate-limit'],
    publishedFingerprint: 'fp',
  });

  const replaced = reduceWorkbench(state, {
    type: 'edgeReplaced',
    from: 'client-node-1',
    fromPort: 'next',
    to: 'client-node-3',
  });

  assertEquals(
    replaced.graphs.client.edges.some((edge) =>
      edge.from === 'client-node-1' &&
      edge.fromPort === 'next' &&
      edge.to === 'client-node-2'
    ),
    false,
  );
  const replacementEdges = replaced.graphs.client.edges.filter((edge) =>
    edge.from === 'client-node-1' && edge.fromPort === 'next'
  );
  assertEquals(replacementEdges.length, 1);
  assertEquals(replacementEdges[0].to, 'client-node-3');
  assertEquals(replacementEdges[0].toPort, 'in');
  assertEquals(
    replaced.graphs.client.edges.some((edge) =>
      edge.from === 'client-node-3' &&
      edge.fromPort === 'next' &&
      edge.to === 'client-node-2' &&
      edge.toPort === 'in'
    ),
    true,
  );
  assertEquals(validatePipelineGraph(replaced.graphs.client).valid, true);
  const serialized = graphToPipelines(replaced.graphs)
    .client as PipelineEntryForTest[];
  assertEquals(serialized.map((entry) => entry.policy), [
    'accept',
    'rate-limit',
    'write-guard',
  ]);
});

Deno.test('workbench reducer closes modal when undo or redo changes graph', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = policyNode(state, 'client', 'accept');

  state = reduceWorkbench(state, {
    type: 'nodeMoved',
    nodeId: node.id,
    x: 160,
    y: 96,
  });
  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, { type: 'undo' });

  assertEquals(state.ui.activeModal, { type: 'none' });

  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });
  state = reduceWorkbench(state, { type: 'redo' });

  assertEquals(state.ui.activeModal, { type: 'none' });
});

Deno.test('workbench reducer rejects edge replacement that would orphan a node', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }, { policy: 'write-guard' }],
    server: [],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard'],
    publishedFingerprint: 'fp',
  });

  const rejected = reduceWorkbench(state, {
    type: 'edgeReplaced',
    from: 'client-start',
    fromPort: 'next',
    to: 'client-node-2',
  });

  assertStrictEquals(rejected, state);
});

Deno.test('workbench reducer records policy node add history only for current direction', () => {
  const graphs = pipelinesToGraph({ client: [], server: [] });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const clientHistory = state.history.client;

  state = reduceWorkbench(state, {
    type: 'directionChanged',
    direction: 'server',
  });
  state = reduceWorkbench(state, {
    type: 'policyNodeAdded',
    policy: 'accept',
    position: { x: 160, y: 80 },
  });

  assertStrictEquals(state.history.client, clientHistory);
  assertEquals(state.history.client.past.length, 0);
  assertEquals(state.history.server.past.length, 1);
});
