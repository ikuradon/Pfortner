import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.18';
import {
  graphToPipelines,
  matchExecutionSteps,
  pipelinesToGraph,
  validatePipelineGraph,
} from '../../admin/static/pipeline_graph.js';
import { buildYamlPreview, defaultConfigForPolicy } from '../../admin/static/pipelines.js';

Deno.test('pipeline editor defaults protected-event to require authentication', () => {
  assertEquals(defaultConfigForPolicy('protected-event'), { require_auth: true });
});

Deno.test('pipeline editor defaults ip-filter to runtime blocklist schema', () => {
  const config = defaultConfigForPolicy('ip-filter') as Record<string, unknown>;
  assertEquals(config, { blocklist: { ips: [], cidrs: [] } });
});

Deno.test('pipeline editor YAML preview includes protected-event config', () => {
  const yaml = buildYamlPreview({
    client: [],
    server: [{ policy: 'protected-event', config: defaultConfigForPolicy('protected-event') }],
  });

  assertStringIncludes(yaml, '- policy: protected-event');
  assertStringIncludes(yaml, 'require_auth: true');
});

Deno.test('pipeline editor YAML preview serializes ip-filter blocklist schema', () => {
  const yaml = buildYamlPreview({
    client: [{ policy: 'ip-filter', config: defaultConfigForPolicy('ip-filter') }],
    server: [],
  });

  assertStringIncludes(yaml, '- policy: ip-filter');
  assertStringIncludes(yaml, 'blocklist:');
  assertStringIncludes(yaml, 'ips: []');
  assertStringIncludes(yaml, 'cidrs: []');
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

  assertEquals(graph.client.nodes.map((node: any) => node.policy), ['start', 'kind-filter', 'accept']);
  assertEquals(graph.client.edges.map((edge: any) => [edge.from, edge.to, edge.fromPort]), [
    ['client-start', 'client-node-1', 'next'],
    ['client-node-1', 'client-node-2', 'next'],
  ]);
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
  const clientEdges = graph.client.edges.map((edge: any) => [edge.from, edge.fromPort, edge.to]);

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
  const clientEdges = graph.client.edges.map((edge: any) => [edge.from, edge.fromPort, edge.to]);

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
    client: [{ policy: 'accept', config: {} }, { policy: 'rate-limit', config: { max_per_minute: 10 } }],
    server: [],
  });

  graph.client.edges.push({ id: 'cycle', from: 'client-node-2', fromPort: 'next', to: 'client-node-1', toPort: 'in' });
  const cycleResult = validatePipelineGraph(graph.client);
  assertEquals(cycleResult.valid, false);
  assertEquals(cycleResult.errors.some((error: any) => error.code === 'cycle'), true);

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
  assertEquals(mergeResult.errors.some((error: any) => error.code === 'multiple-inputs'), true);
});

Deno.test('pipeline graph validation rejects invalid starts, dangling edges, and unreachable nodes', () => {
  const noStartResult = validatePipelineGraph({
    direction: 'client',
    nodes: [],
    edges: [],
  });
  assertEquals(noStartResult.valid, false);
  assertEquals(noStartResult.errors.some((error: any) => error.code === 'start-count'), true);

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
  assertEquals(danglingResult.errors.some((error: any) => error.code === 'dangling-edge'), true);

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
  assertEquals(unreachableResult.errors.some((error: any) => error.code === 'unreachable-node'), true);
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
