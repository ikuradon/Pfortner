import { assertEquals } from '@std/assert';
import { graphToPipelines, pipelinesToGraph } from './graph.js';
import { buildPipelineDraft, fingerprintPipelines } from './workbench_state.js';
import { createInitialWorkbenchState, reduceWorkbench, type WorkbenchAction } from './workbench_reducer.ts';
import {
  loadWorkbenchDraft,
  publishWorkbenchGraphs,
  runWorkbenchPlayground,
  saveWorkbenchDraft,
  type WorkbenchActionServices,
} from './workbench_actions.ts';

function services(
  overrides: Partial<WorkbenchActionServices> = {},
): WorkbenchActionServices {
  return {
    fetchPipelineDraft: () => Promise.resolve(null),
    savePipelineDraft: () => Promise.resolve({ status: 'saved' }),
    publishPipelines: () => Promise.resolve({}),
    evaluatePipeline: () => Promise.resolve({ result: 'ok' }),
    readLocalDraft: () => null,
    writeLocalDraft: () => false,
    now: () => 1000,
    ...overrides,
  };
}

function dispatchCollector() {
  const actions: WorkbenchAction[] = [];
  return {
    actions,
    dispatch(action: WorkbenchAction) {
      actions.push(action);
    },
  };
}

Deno.test('workbench save action persists current reducer state to server and local draft', async () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'write-guard' }],
    server: [{ policy: 'rate-limit' }],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['write-guard', 'rate-limit'],
    publishedFingerprint: fingerprintPipelines(graphToPipelines(graphs)),
  });
  let serverDraft: unknown;
  let localDraft: unknown;
  const { actions, dispatch } = dispatchCollector();

  await saveWorkbenchDraft(
    state,
    services({
      savePipelineDraft(draft) {
        serverDraft = draft;
        return Promise.resolve({ status: 'saved' });
      },
      writeLocalDraft(draft) {
        localDraft = draft;
        return true;
      },
    }),
    dispatch,
  );

  assertEquals(serverDraft, localDraft);
  assertEquals(
    Boolean(
      (serverDraft as { graphs: typeof graphs }).graphs.client.nodes.find((node) => node.policy === 'write-guard'),
    ),
    true,
  );
  assertEquals(actions, [
    {
      type: 'draftSaved',
      message: 'DAG saved',
      kind: 'success',
      savedDraftFingerprint: state.savedDraftFingerprint,
    },
  ]);
});

Deno.test('workbench load action falls back to local draft when server draft is invalid', async () => {
  const localGraphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [{ policy: 'rate-limit' }],
  });
  const localDraft = buildPipelineDraft({
    graphs: localGraphs,
    viewports: {
      client: { zoom: 1.2, pan: { x: 11, y: 22 } },
      server: { zoom: 1, pan: { x: 56, y: 80 } },
    },
    publishedFingerprint: 'published-fp',
    now: 1000,
  });
  const { actions, dispatch } = dispatchCollector();

  await loadWorkbenchDraft(
    services({
      fetchPipelineDraft: () => Promise.resolve({ version: 1, graphs: { client: null, server: null } }),
      readLocalDraft: () => localDraft,
    }),
    dispatch,
  );

  assertEquals(actions[0]?.type, 'graphsLoaded');
  if (actions[0]?.type !== 'graphsLoaded') return;
  assertEquals(actions[0].graphs.client.nodes.some((node) => node.policy === 'accept'), true);
  assertEquals(actions[0].viewports, localDraft.viewports);
  assertEquals(actions[0].message, 'Loaded saved DAG');
});

Deno.test('workbench publish action posts serialized graphs and dispatches published state', async () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [{ policy: 'rate-limit' }],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'rate-limit'],
    publishedFingerprint: '',
  });
  const expectedPipelines = graphToPipelines(graphs);
  let postedPipelines: unknown;
  let savedDraft: unknown;
  let localDraft: unknown;
  const { actions, dispatch } = dispatchCollector();

  await publishWorkbenchGraphs(
    state,
    services({
      publishPipelines(pipelines) {
        postedPipelines = pipelines;
        return Promise.resolve({ pipelines });
      },
      savePipelineDraft(draft) {
        savedDraft = draft;
        return Promise.resolve({ status: 'saved' });
      },
      writeLocalDraft(draft) {
        localDraft = draft;
        return true;
      },
    }),
    dispatch,
  );

  assertEquals(postedPipelines, expectedPipelines);
  assertEquals(savedDraft, localDraft);
  assertEquals(
    (savedDraft as { lastPublishedFingerprint: string }).lastPublishedFingerprint,
    fingerprintPipelines(expectedPipelines),
  );
  assertEquals(actions, [
    {
      type: 'published',
      pipelines: expectedPipelines,
      message: 'Pipeline published',
    },
    {
      type: 'draftSaved',
      message: 'Pipeline published',
      kind: 'success',
      savedDraftFingerprint: state.savedDraftFingerprint,
    },
  ]);
});

Deno.test('workbench playground action rejects non-array JSON before API evaluation', async () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [{ policy: 'rate-limit' }],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'rate-limit'],
    publishedFingerprint: '',
  });
  state = reduceWorkbench(state, { type: 'nodeDoubleClicked', nodeId: 'client-start' });
  let evaluated = false;
  const { actions, dispatch } = dispatchCollector();

  await runWorkbenchPlayground(
    state,
    '{"kind":1}',
    services({
      evaluatePipeline() {
        evaluated = true;
        return Promise.resolve({});
      },
    }),
    dispatch,
  );

  assertEquals(evaluated, false);
  assertEquals(actions, [
    {
      type: 'playgroundFailed',
      message: 'Message must be a JSON array, e.g. ["EVENT", {...}]',
    },
  ]);
});

Deno.test('workbench playground action validates graph before API evaluation', async () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  graphs.client.nodes = [];
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: '',
  });
  let evaluated = false;
  const { actions, dispatch } = dispatchCollector();

  await runWorkbenchPlayground(
    state,
    '["EVENT",{"id":"1"}]',
    services({
      evaluatePipeline() {
        evaluated = true;
        return Promise.resolve({});
      },
    }),
    dispatch,
  );

  assertEquals(evaluated, false);
  assertEquals(actions[0]?.type, 'playgroundFailed');
  if (actions[0]?.type === 'playgroundFailed') {
    assertEquals(actions[0].message, 'Graph validation failed: start-count, dangling-edge');
  }
});

Deno.test('workbench playground action rejects empty messages before API evaluation', async () => {
  const state = createInitialWorkbenchState({
    graphs: pipelinesToGraph({
      client: [{ policy: 'accept' }],
      server: [],
    }),
    plugins: ['accept'],
    publishedFingerprint: '',
  });
  let evaluated = false;
  const { actions, dispatch } = dispatchCollector();

  await runWorkbenchPlayground(
    state,
    '   ',
    services({
      evaluatePipeline() {
        evaluated = true;
        return Promise.resolve({});
      },
    }),
    dispatch,
  );

  assertEquals(evaluated, false);
  assertEquals(actions, [
    {
      type: 'playgroundFailed',
      message: 'Please enter a message.',
    },
  ]);
});

Deno.test('workbench playground action evaluates the active direction pipeline', async () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [{ policy: 'rate-limit' }],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'rate-limit'],
    publishedFingerprint: '',
  });
  let payload: unknown;
  const { actions, dispatch } = dispatchCollector();

  await runWorkbenchPlayground(
    state,
    '["EVENT",{"id":"1"}]',
    services({
      evaluatePipeline(nextPayload) {
        payload = nextPayload;
        return Promise.resolve({ result: 'accepted' });
      },
    }),
    dispatch,
  );

  assertEquals(payload, {
    pipeline: [{ policy: 'accept' }],
    message: ['EVENT', { id: '1' }],
    direction: 'client',
    connectionInfo: {},
  });
  assertEquals(actions, [
    {
      type: 'playgroundResultLoaded',
      result: { result: 'accepted' },
    },
  ]);
});

Deno.test('workbench playground action forwards modal direction and connection context', async () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [{ policy: 'write-guard', config: { require_auth: true } }],
  });
  const state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard'],
    publishedFingerprint: '',
  });
  let payload: unknown;
  const { actions, dispatch } = dispatchCollector();

  await runWorkbenchPlayground(
    state,
    {
      message: '["EVENT",{"id":"1"}]',
      direction: 'server',
      connectionInfo: {
        authenticated: true,
        pubkey: 'pubkey-1',
        clientIp: '203.0.113.10',
      },
    },
    services({
      evaluatePipeline(nextPayload) {
        payload = nextPayload;
        return Promise.resolve({ result: 'accepted' });
      },
    }),
    dispatch,
  );

  assertEquals(payload, {
    pipeline: [{ policy: 'write-guard', config: { require_auth: true } }],
    message: ['EVENT', { id: '1' }],
    direction: 'server',
    connectionInfo: {
      authenticated: true,
      pubkey: 'pubkey-1',
      clientIp: '203.0.113.10',
    },
  });
  assertEquals(actions, [
    {
      type: 'playgroundResultLoaded',
      result: { result: 'accepted' },
    },
  ]);
});
