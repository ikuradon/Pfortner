import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.18';
import {
  graphToPipelines,
  matchExecutionSteps,
  pipelinesToGraph,
  validatePipelineGraph,
} from '../../admin/static/pipeline_graph.js';
import {
  configToEditorRows,
  parseConfigJson,
  shouldOpenPlaygroundForNode,
  shouldRenderRunAction,
  shouldRenderSettingsAction,
  updateConfigFromEditorRows,
} from '../../admin/static/pipeline_config_editor.js';
import {
  applyHistoryChange,
  buildPipelineDraft,
  fingerprintPipelines,
  getWorkbenchChangeState,
  hasUnpublishedChanges,
  initialDirectionHistoryState,
  initialHistoryState,
  isUndoAvailable,
  LAST_DIRECTION_KEY,
  LOCAL_DRAFT_KEY,
  normalizeWorkbenchDraft,
  PALETTE_COLLAPSED_KEY,
  recordDirectionHistorySnapshot,
  recordHistorySnapshot,
} from '../../admin/static/pipeline_workbench_state.js';
import { buildPublishConfirmationMessage, buildYamlPreview } from '../../admin/islands/pipeline/yaml_preview.ts';
import {
  addMatchCaseDraftConfig,
  defaultConfigForPolicy,
  isMovablePipelineNode,
  reconcileMatchCaseEdges,
  removeMatchCaseDraftConfig,
  shouldRenderInputPort,
} from '../../admin/islands/pipeline/node_defaults.ts';

Deno.test('pipeline editor defaults protected-event to require authentication', () => {
  assertEquals(defaultConfigForPolicy('protected-event'), {
    require_auth: true,
  });
});

Deno.test('pipeline editor defaults ip-filter to runtime blocklist schema', () => {
  const config = defaultConfigForPolicy('ip-filter') as Record<string, unknown>;
  assertEquals(config, { blocklist: { ips: [], cidrs: [] } });
});

Deno.test('pipeline editor defaults kind-filter to runtime mode schema', () => {
  assertEquals(defaultConfigForPolicy('kind-filter'), {
    mode: 'allow',
    kinds: [1, 3, 6, 7],
  });
});

Deno.test('pipeline editor defaults rate-limit to runtime window schema', () => {
  assertEquals(defaultConfigForPolicy('rate-limit'), {
    scope: 'connection',
    window: 60,
    max_events: 60,
    max_requests: 120,
  });
});

Deno.test('pipeline editor defaults content and route policies to runtime schemas', () => {
  assertEquals(defaultConfigForPolicy('spam-filter'), {
    max_content_length: 1000,
  });
  assertEquals(defaultConfigForPolicy('content-filter'), {
    blocked_words: [],
    blocked_patterns: [],
  });
  assertEquals(defaultConfigForPolicy('route'), {
    upstream: '',
    condition: { message_type: 'REQ' },
  });
});

Deno.test('pipeline editor YAML preview includes protected-event config', () => {
  const yaml = buildYamlPreview({
    client: [],
    server: [{
      policy: 'protected-event',
      config: defaultConfigForPolicy('protected-event'),
    }],
  });

  assertStringIncludes(yaml, '- policy: protected-event');
  assertStringIncludes(yaml, 'require_auth: true');
});

Deno.test('pipeline editor YAML preview serializes ip-filter blocklist schema', () => {
  const yaml = buildYamlPreview({
    client: [{
      policy: 'ip-filter',
      config: defaultConfigForPolicy('ip-filter'),
    }],
    server: [],
  });

  assertStringIncludes(yaml, '- policy: ip-filter');
  assertStringIncludes(yaml, 'blocklist:');
  assertStringIncludes(yaml, 'ips: []');
  assertStringIncludes(yaml, 'cidrs: []');
});

Deno.test('pipeline editor does not render an input port for the start node', () => {
  assertEquals(
    shouldRenderInputPort({ type: 'start', policy: 'start' }),
    false,
  );
  assertEquals(
    shouldRenderInputPort({
      type: 'policy',
      policy: 'accept',
    }),
    true,
  );
});

Deno.test('pipeline editor allows the start node to move', () => {
  assertEquals(
    isMovablePipelineNode({ type: 'start', policy: 'start' }),
    true,
  );
  assertEquals(
    isMovablePipelineNode({
      type: 'policy',
      policy: 'accept',
    }),
    true,
  );
});

Deno.test('pipeline editor exposes node actions for start and policy nodes', () => {
  const startNode = { type: 'start', policy: 'start' };
  const policyNode = { type: 'policy', policy: 'accept' };

  assertEquals(shouldRenderSettingsAction(startNode), false);
  assertEquals(shouldRenderRunAction(startNode), true);
  assertEquals(shouldOpenPlaygroundForNode(startNode), true);

  assertEquals(shouldRenderSettingsAction(policyNode), true);
  assertEquals(shouldRenderRunAction(policyNode), false);
  assertEquals(shouldOpenPlaygroundForNode(policyNode), false);
});

Deno.test('pipeline graph converts linear client and server pipelines round trip', () => {
  const pipelines = {
    client: [
      { policy: 'kind-filter', config: { allow_kinds: [1] } },
      { policy: 'accept', config: {} },
    ],
    server: [{ policy: 'write-guard', config: { require_auth: true } }],
  };

  const graph = pipelinesToGraph(pipelines);

  assertEquals(graph.client.nodes.map((node: any) => node.policy), [
    'start',
    'kind-filter',
    'accept',
  ]);
  assertEquals(
    graph.client.edges.map((edge: any) => [edge.from, edge.to, edge.fromPort]),
    [
      ['client-start', 'client-node-1', 'next'],
      ['client-node-1', 'client-node-2', 'next'],
    ],
  );
  assertEquals(graphToPipelines(graph), pipelines);
});

Deno.test('pipeline graph preserves missing config on round trip', () => {
  const pipelines: any = {
    client: [{ policy: 'accept' }],
    server: [],
  };

  assertEquals(graphToPipelines(pipelinesToGraph(pipelines)), pipelines);
});

Deno.test('pipeline graph preserves when branches as nested pipelines', () => {
  const pipelines = {
    client: [{
      policy: 'when',
      config: {
        condition: { authenticated: true },
        then: [{ policy: 'accept', config: {} }],
        else: [{ policy: 'rate-limit', config: { max_per_minute: 5 } }],
      },
    }],
    server: [],
  };

  const graph = pipelinesToGraph(pipelines);
  const clientEdges = graph.client.edges.map((
    edge: any,
  ) => [edge.from, edge.fromPort, edge.to]);

  assertEquals(clientEdges, [
    ['client-start', 'next', 'client-node-1'],
    ['client-node-1', 'then', 'client-node-2'],
    ['client-node-1', 'else', 'client-node-3'],
  ]);
  assertEquals(graphToPipelines(graph), pipelines);
});

Deno.test('pipeline graph preserves missing when else branch on round trip', () => {
  const pipelines: any = {
    client: [{
      policy: 'when',
      config: {
        condition: { authenticated: true },
        then: [{ policy: 'accept' }],
      },
    }],
    server: [],
  };

  assertEquals(graphToPipelines(pipelinesToGraph(pipelines)), pipelines);
});

Deno.test('pipeline graph preserves match cases and default as nested pipelines', () => {
  const pipelines: any = {
    client: [{
      policy: 'match',
      config: {
        cases: [
          {
            condition: { kind: 1 },
            pipeline: [{ policy: 'accept' }],
          },
          {
            condition: { kind: 2 },
            pipeline: [{ policy: 'rate-limit', config: { max_per_minute: 5 } }],
          },
        ],
        default: [{ policy: 'write-guard', config: { require_auth: true } }],
      },
    }],
    server: [],
  };

  const graph = pipelinesToGraph(pipelines);
  const clientEdges = graph.client.edges.map((
    edge: any,
  ) => [edge.from, edge.fromPort, edge.to]);

  assertEquals(clientEdges, [
    ['client-start', 'next', 'client-node-1'],
    ['client-node-1', 'case:0', 'client-node-2'],
    ['client-node-1', 'case:1', 'client-node-3'],
    ['client-node-1', 'default', 'client-node-4'],
  ]);
  assertEquals(graphToPipelines(graph), pipelines);
});

Deno.test('pipeline graph preserves missing match default branch on round trip', () => {
  const pipelines: any = {
    client: [{
      policy: 'match',
      config: {
        cases: [{
          condition: { kind: 1 },
          pipeline: [{ policy: 'accept' }],
        }],
      },
    }],
    server: [],
  };

  assertEquals(graphToPipelines(pipelinesToGraph(pipelines)), pipelines);
});

Deno.test('pipeline graph validation rejects cycles and unsupported merges', () => {
  const graph = pipelinesToGraph({
    client: [{ policy: 'accept', config: {} }, {
      policy: 'rate-limit',
      config: { max_per_minute: 10 },
    }],
    server: [],
  });

  graph.client.edges.push({
    id: 'cycle',
    from: 'client-node-2',
    fromPort: 'next',
    to: 'client-node-1',
    toPort: 'in',
  });
  const cycleResult = validatePipelineGraph(graph.client);
  assertEquals(cycleResult.valid, false);
  assertEquals(
    cycleResult.errors.some((error: any) => error.code === 'cycle'),
    true,
  );

  const mergeGraph = pipelinesToGraph({
    client: [{
      policy: 'when',
      config: {
        condition: { authenticated: true },
        then: [{ policy: 'accept', config: {} }],
        else: [{ policy: 'rate-limit', config: { max_per_minute: 10 } }],
      },
    }],
    server: [],
  });
  mergeGraph.client.edges.push({
    id: 'unsupported-merge',
    from: 'client-node-3',
    fromPort: 'next',
    to: 'client-node-2',
    toPort: 'in',
  });

  const mergeResult = validatePipelineGraph(mergeGraph.client);
  assertEquals(mergeResult.valid, false);
  assertEquals(
    mergeResult.errors.some((error: any) => error.code === 'multiple-inputs'),
    true,
  );
});

Deno.test('pipeline graph validation rejects invalid starts, dangling edges, and unreachable nodes', () => {
  const noStartResult = validatePipelineGraph({
    direction: 'client',
    nodes: [],
    edges: [],
  });
  assertEquals(noStartResult.valid, false);
  assertEquals(
    noStartResult.errors.some((error: any) => error.code === 'start-count'),
    true,
  );

  const danglingGraph: any = pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] }).client;
  danglingGraph.edges.push({
    id: 'dangling',
    from: 'client-node-1',
    fromPort: 'next',
    to: 'missing-node',
    toPort: 'in',
  });
  const danglingResult = validatePipelineGraph(danglingGraph);
  assertEquals(danglingResult.valid, false);
  assertEquals(
    danglingResult.errors.some((error: any) => error.code === 'dangling-edge'),
    true,
  );

  const unreachableGraph: any = pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] }).client;
  unreachableGraph.nodes.push({
    id: 'client-node-unreachable',
    type: 'policy',
    policy: 'rate-limit',
    config: { max_per_minute: 10 },
    x: 0,
    y: 0,
    width: 180,
    height: 72,
    path: ['unreachable'],
  });
  const unreachableResult = validatePipelineGraph(unreachableGraph);
  assertEquals(unreachableResult.valid, false);
  assertEquals(
    unreachableResult.errors.some((error: any) => error.code === 'unreachable-node'),
    true,
  );
});

Deno.test('pipeline graph matches execution steps to graph nodes in order', () => {
  const graph = pipelinesToGraph({
    client: [
      { policy: 'accept', config: {} },
      { policy: 'accept', config: {} },
    ],
    server: [],
  });

  const matches = matchExecutionSteps(graph.client, [
    { policy: 'accept', action: 'next' },
    { policy: 'accept', action: 'accept' },
  ]);

  assertEquals(matches, [
    { stepIndex: 0, nodeId: 'client-node-1', action: 'next' },
    { stepIndex: 1, nodeId: 'client-node-2', action: 'accept' },
  ]);
});

Deno.test('pipeline graph matches execution steps inside the executed when branch', () => {
  const graph = pipelinesToGraph({
    client: [{
      policy: 'when',
      config: {
        condition: { authenticated: true },
        then: [{ policy: 'accept' }],
        else: [{ policy: 'accept' }],
      },
    }],
    server: [],
  });

  const matches = matchExecutionSteps(graph.client, [
    { policy: 'when', action: 'next', branch: 'else' },
    { policy: 'accept', action: 'accept' },
  ]);

  assertEquals(matches, [
    { stepIndex: 0, nodeId: 'client-node-1', action: 'next' },
    { stepIndex: 1, nodeId: 'client-node-3', action: 'accept' },
  ]);
});

Deno.test('pipeline graph matches execution steps inside the executed match default branch', () => {
  const graph = pipelinesToGraph({
    client: [
      {
        policy: 'match',
        config: {
          cases: [],
          default: [{ policy: 'accept' }],
        },
      },
      { policy: 'accept' },
    ],
    server: [],
  });

  const matches = matchExecutionSteps(graph.client, [
    { policy: 'match', action: 'next', branch: 'default' },
    { policy: 'accept', action: 'accept' },
  ]);

  assertEquals(matches, [
    { stepIndex: 0, nodeId: 'client-node-1', action: 'next' },
    { stepIndex: 1, nodeId: 'client-node-2', action: 'accept' },
  ]);
});

Deno.test('pipeline graph matches execution steps inside an executed match case branch', () => {
  const graph = pipelinesToGraph({
    client: [
      {
        policy: 'match',
        config: {
          cases: [{
            condition: { kind: 1 },
            pipeline: [{ policy: 'accept' }],
          }],
        },
      },
      { policy: 'accept' },
    ],
    server: [],
  });

  const matches = matchExecutionSteps(graph.client, [
    { policy: 'match', action: 'next', branch: 'case' },
    { policy: 'accept', action: 'accept' },
  ]);

  assertEquals(matches, [
    { stepIndex: 0, nodeId: 'client-node-1', action: 'next' },
    { stepIndex: 1, nodeId: 'client-node-2', action: 'accept' },
  ]);
});

Deno.test('pipeline workbench history records undo and redo snapshots', () => {
  const first = {
    client: { nodes: [{ id: 'client-start', x: 0 }], edges: [] },
    server: { nodes: [], edges: [] },
  };
  const second = {
    client: { nodes: [{ id: 'client-start', x: 80 }], edges: [] },
    server: { nodes: [], edges: [] },
  };
  let history = initialHistoryState(first);

  history = recordHistorySnapshot(history, second);
  assertEquals(isUndoAvailable(history), true);

  const undone = applyHistoryChange(history, 'undo');
  assertEquals(undone.present.client.nodes[0].x, 0);
  assertEquals(undone.future.length, 1);

  const redone = applyHistoryChange(undone, 'redo');
  assertEquals(redone.present.client.nodes[0].x, 80);
  assertEquals(redone.future.length, 0);
});

Deno.test('pipeline workbench history is scoped per direction', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept', config: {} }],
    server: [{ policy: 'write-guard', config: { require_auth: true } }],
  });
  const histories = initialDirectionHistoryState(graphs);
  const changedClient = {
    ...graphs.client,
    nodes: graphs.client.nodes.map((node) => node.id === 'client-node-1' ? { ...node, x: node.x + 32 } : node),
  };

  const nextHistories = recordDirectionHistorySnapshot(
    histories,
    'client',
    changedClient,
  );

  assertEquals(nextHistories.client.past.length, 1);
  assertEquals(nextHistories.server.past.length, 0);
  assertEquals(
    nextHistories.client.present.nodes.find((node: any) => node.id === 'client-node-1')?.x,
    changedClient.nodes[1].x,
  );
  assertEquals(nextHistories.server.present, graphs.server);
});

Deno.test('pipeline workbench fingerprints are stable for equivalent pipelines', () => {
  const a = { client: [{ policy: 'accept', config: {} }], server: [] };
  const b = { server: [], client: [{ config: {}, policy: 'accept' }] };

  assertEquals(fingerprintPipelines(a), fingerprintPipelines(b));
});

Deno.test('pipeline workbench draft normalizes expected graph shape', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept', config: {} }],
    server: [],
  });
  const published = fingerprintPipelines(graphToPipelines(graphs));

  const draft = buildPipelineDraft({
    graphs,
    viewports: {
      client: { zoom: 1, pan: { x: 10, y: 20 } },
      server: { zoom: 1, pan: { x: 0, y: 0 } },
    },
    publishedFingerprint: published,
    now: 1000,
  });
  const normalized = normalizeWorkbenchDraft(draft);

  assertEquals('error' in normalized, false);
  if (!('error' in normalized)) {
    assertEquals(normalized.draft.version, 1);
    assertEquals(normalized.draft.graphs.client.nodes[0].id, 'client-start');
    assertEquals(normalized.draft.viewports.client.pan.x, 10);
    assertEquals(normalized.draft.lastPublishedFingerprint, published);
  }
});

Deno.test('pipeline workbench draft does not read current time implicitly', () => {
  const graphs = pipelinesToGraph({
    client: [],
    server: [],
  });
  const published = fingerprintPipelines(graphToPipelines(graphs));

  const draft = buildPipelineDraft({
    graphs,
    viewports: {},
    publishedFingerprint: published,
  });

  assertEquals(draft.updatedAt, '');
});

Deno.test('pipeline workbench detects unpublished changes', () => {
  const published = fingerprintPipelines({ client: [], server: [] });
  const changed = fingerprintPipelines({
    client: [{ policy: 'accept', config: {} }],
    server: [],
  });

  assertEquals(hasUnpublishedChanges(changed, published), true);
  assertEquals(hasUnpublishedChanges(published, published), false);
});

Deno.test('pipeline workbench reports saved DAG and published state separately', () => {
  assertEquals(
    getWorkbenchChangeState({
      currentDraftFingerprint: 'draft-b',
      savedDraftFingerprint: 'draft-a',
      currentPipelineFingerprint: 'pipeline-b',
      publishedFingerprint: 'pipeline-a',
    }),
    {
      hasUnsavedDagChanges: true,
      hasUnpublishedChanges: true,
      dagLabel: 'Unsaved DAG',
      publishLabel: 'Unpublished changes',
    },
  );
  assertEquals(
    getWorkbenchChangeState({
      currentDraftFingerprint: 'same-draft',
      savedDraftFingerprint: 'same-draft',
      currentPipelineFingerprint: 'same-pipeline',
      publishedFingerprint: 'same-pipeline',
    }),
    {
      hasUnsavedDagChanges: false,
      hasUnpublishedChanges: false,
      dagLabel: 'Saved DAG',
      publishLabel: 'Published',
    },
  );
});

Deno.test('pipeline publish confirmation message includes YAML preview', () => {
  const yaml = buildYamlPreview({
    client: [{ policy: 'write-guard', config: { require_auth: true } }],
    server: [],
  });
  const message = buildPublishConfirmationMessage(yaml);

  assertStringIncludes(message, 'Publish');
  assertStringIncludes(message, 'pipelines:');
  assertStringIncludes(message, 'write-guard');
});

Deno.test('pipeline workbench local preference keys are stable', () => {
  assertEquals(PALETTE_COLLAPSED_KEY, 'pfortner.pipelinePaletteCollapsed.v1');
  assertEquals(LOCAL_DRAFT_KEY, 'pfortner.pipelineWorkbenchDraft.v1');
  assertEquals(LAST_DIRECTION_KEY, 'pfortner.pipelineDirection.v1');
});

Deno.test('pipeline node actions separate start run from policy settings', () => {
  const start = { type: 'start', policy: 'start' };
  const policy = { type: 'policy', policy: 'write-guard' };

  assertEquals(shouldRenderRunAction(start), true);
  assertEquals(shouldRenderSettingsAction(start), false);
  assertEquals(shouldOpenPlaygroundForNode(start), true);

  assertEquals(shouldRenderRunAction(policy), false);
  assertEquals(shouldRenderSettingsAction(policy), true);
  assertEquals(shouldOpenPlaygroundForNode(policy), false);
});

Deno.test('pipeline config editor parses JSON with readable errors', () => {
  assertEquals(parseConfigJson('{"require_auth":true}'), {
    config: { require_auth: true },
  });

  const bad = parseConfigJson('{');
  assertEquals('error' in bad, true);
});

Deno.test('pipeline config editor converts generic interactive rows', () => {
  const rows = configToEditorRows({
    require_auth: true,
    window: 60,
    upstream: 'wss://relay.example',
    kinds: [1, 3],
    condition: { message_type: 'REQ' },
  });

  const updated = updateConfigFromEditorRows(rows.map((row: any) => {
    if (row.key === 'window') return { ...row, value: '120' };
    if (row.key === 'require_auth') return { ...row, value: false };
    return row;
  }));

  assertEquals(updated, {
    config: {
      require_auth: false,
      window: 120,
      upstream: 'wss://relay.example',
      kinds: [1, 3],
      condition: { message_type: 'REQ' },
    },
  });
});

Deno.test('pipeline match case draft helpers keep config changes local', () => {
  const original = {
    cases: [
      { condition: { kind: 1 }, pipeline: [{ policy: 'accept' }] },
      { condition: { kind: 2 }, pipeline: [{ policy: 'reject' }] },
    ],
    default: [],
  };

  const removed = removeMatchCaseDraftConfig(original, 0, [0, 1]);

  assertEquals(original.cases.length, 2);
  assertEquals(removed, {
    config: {
      cases: [
        { condition: { kind: 2 }, pipeline: [{ policy: 'reject' }] },
      ],
      default: [],
    },
    caseIndexMap: [1],
  });

  const added = addMatchCaseDraftConfig(removed.config, removed.caseIndexMap);
  assertEquals(added.config.cases.length, 2);
  assertEquals(added.caseIndexMap, [1, null]);
});

Deno.test('pipeline match case edge reconciliation prunes and renumbers removed cases', () => {
  const edges = [
    { id: 'case-0', from: 'match-node', fromPort: 'case:0', to: 'a' },
    { id: 'case-1', from: 'match-node', fromPort: 'case:1', to: 'b' },
    { id: 'case-2', from: 'match-node', fromPort: 'case:2', to: 'c' },
    { id: 'default', from: 'match-node', fromPort: 'default', to: 'd' },
    { id: 'other', from: 'other-node', fromPort: 'case:1', to: 'e' },
  ];

  assertEquals(
    reconcileMatchCaseEdges(edges, 'match-node', [0, 2], 2),
    [
      { id: 'case-0', from: 'match-node', fromPort: 'case:0', to: 'a' },
      { id: 'case-2', from: 'match-node', fromPort: 'case:1', to: 'c' },
      { id: 'default', from: 'match-node', fromPort: 'default', to: 'd' },
      { id: 'other', from: 'other-node', fromPort: 'case:1', to: 'e' },
    ],
  );
});
