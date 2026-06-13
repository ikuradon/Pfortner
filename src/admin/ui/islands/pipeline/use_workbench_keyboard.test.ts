import { assertEquals } from '@std/assert';
import { pipelinesToGraph } from './graph.js';
import { createInitialWorkbenchState, reduceWorkbench } from './workbench_reducer.ts';
import { keyboardActionsForWorkbench } from './use_workbench_keyboard.ts';

function event(
  key: string,
  overrides: Partial<Parameters<typeof keyboardActionsForWorkbench>[1]> = {},
) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides,
  };
}

Deno.test('workbench keyboard maps undo and redo shortcuts', () => {
  const state = createInitialWorkbenchState({
    graphs: pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] }),
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });

  assertEquals(
    keyboardActionsForWorkbench(state, event('z', { ctrlKey: true })),
    {
      preventDefault: true,
      actions: [{ type: 'undo' }],
    },
  );
  assertEquals(
    keyboardActionsForWorkbench(
      state,
      event('z', { metaKey: true, shiftKey: true }),
    ),
    {
      preventDefault: true,
      actions: [{ type: 'redo' }],
    },
  );
  assertEquals(
    keyboardActionsForWorkbench(state, event('y', { ctrlKey: true })),
    {
      preventDefault: true,
      actions: [{ type: 'redo' }],
    },
  );
});

Deno.test('workbench keyboard deletes selected non-start nodes', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }, { policy: 'write-guard' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept', 'write-guard'],
    publishedFingerprint: 'fp',
  });
  const start = state.graphs.client.nodes.find((node) => node.policy === 'start')!;
  const accept = state.graphs.client.nodes.find((node) => node.policy === 'accept')!;
  const writeGuard = state.graphs.client.nodes.find((node) => node.policy === 'write-guard')!;
  state = reduceWorkbench(state, {
    type: 'selectionReplaced',
    nodeIds: [start.id, accept.id, writeGuard.id],
  });

  assertEquals(
    keyboardActionsForWorkbench(state, event('Delete')),
    {
      preventDefault: true,
      actions: [
        { type: 'nodeDeleted', nodeId: accept.id },
        { type: 'nodeDeleted', nodeId: writeGuard.id },
      ],
    },
  );
  assertEquals(
    keyboardActionsForWorkbench(state, event('Backspace')).actions.length,
    2,
  );
});

Deno.test('workbench keyboard closes active modal with Escape', () => {
  const graphs = pipelinesToGraph({
    client: [{ policy: 'accept' }],
    server: [],
  });
  let state = createInitialWorkbenchState({
    graphs,
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const node = state.graphs.client.nodes.find((item) => item.policy === 'accept')!;
  state = reduceWorkbench(state, {
    type: 'nodeDoubleClicked',
    nodeId: node.id,
  });

  assertEquals(
    keyboardActionsForWorkbench(state, event('Escape')),
    {
      preventDefault: true,
      actions: [{ type: 'modalClosed' }],
    },
  );
});

Deno.test('workbench keyboard ignores editable targets outside modal shortcuts', () => {
  const state = createInitialWorkbenchState({
    graphs: pipelinesToGraph({ client: [{ policy: 'accept' }], server: [] }),
    plugins: ['accept'],
    publishedFingerprint: 'fp',
  });
  const inputTarget = { tagName: 'INPUT' };
  const editableTarget = { isContentEditable: true };

  assertEquals(
    keyboardActionsForWorkbench(
      state,
      event('Delete', { target: inputTarget }),
    ),
    {
      preventDefault: false,
      actions: [],
    },
  );
  assertEquals(
    keyboardActionsForWorkbench(
      state,
      event('z', { ctrlKey: true, target: editableTarget }),
    ),
    {
      preventDefault: false,
      actions: [],
    },
  );
});

Deno.test('workbench keyboard does not prevent delete when nothing selectable is selected', () => {
  const state = createInitialWorkbenchState({
    graphs: pipelinesToGraph({ client: [], server: [] }),
    plugins: [],
    publishedFingerprint: 'fp',
  });

  assertEquals(
    keyboardActionsForWorkbench(state, event('Delete')),
    {
      preventDefault: false,
      actions: [],
    },
  );
});
