import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@1.0.18';
import { pipelinesToGraph } from '../../static/pipeline_graph.js';
import { createInitialWorkbenchState, reduceWorkbench } from './workbench_reducer.ts';

type PipelineNodeForTest = {
  id: string;
  policy?: string;
  x?: number;
  y?: number;
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
