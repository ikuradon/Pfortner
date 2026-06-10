import { useEffect } from 'preact/hooks';
import type { WorkbenchAction, WorkbenchState } from './workbench_reducer.ts';

interface KeyboardTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

export interface WorkbenchKeyboardEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

export interface WorkbenchKeyboardDecision {
  preventDefault: boolean;
  actions: WorkbenchAction[];
}

const NO_KEYBOARD_ACTION: WorkbenchKeyboardDecision = {
  preventDefault: false,
  actions: [],
};

function isEditableTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false;
  const item = target as KeyboardTargetLike;
  if (item.isContentEditable === true) return true;
  const tagName = typeof item.tagName === 'string' ? item.tagName.toUpperCase() : '';
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function isStartNode(
  node: { type?: string; policy?: string } | null | undefined,
): boolean {
  return node?.type === 'start' || node?.policy === 'start';
}

function selectedDeletableNodeIds(state: WorkbenchState): string[] {
  const graph = state.graphs[state.direction];
  return state.selectedNodeIds.filter((nodeId) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    return node !== undefined && !isStartNode(node);
  });
}

export function keyboardActionsForWorkbench(
  state: WorkbenchState,
  event: WorkbenchKeyboardEventLike,
): WorkbenchKeyboardDecision {
  const key = event.key.toLowerCase();
  const hasCommandModifier = event.ctrlKey === true || event.metaKey === true;

  if (state.ui.activeModal.type !== 'none') {
    if (key !== 'escape') return NO_KEYBOARD_ACTION;
    return {
      preventDefault: true,
      actions: [{ type: 'modalClosed' }],
    };
  }

  if (isEditableTarget(event.target)) return NO_KEYBOARD_ACTION;

  if (hasCommandModifier && key === 'z') {
    return {
      preventDefault: true,
      actions: [{ type: event.shiftKey === true ? 'redo' : 'undo' }],
    };
  }

  if (hasCommandModifier && key === 'y') {
    return {
      preventDefault: true,
      actions: [{ type: 'redo' }],
    };
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    const nodeIds = selectedDeletableNodeIds(state);
    if (nodeIds.length === 0) return NO_KEYBOARD_ACTION;
    return {
      preventDefault: true,
      actions: nodeIds.map((nodeId) => ({ type: 'nodeDeleted', nodeId })),
    };
  }

  return NO_KEYBOARD_ACTION;
}

export function useWorkbenchKeyboard(
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const decision = keyboardActionsForWorkbench(state, event);
      if (!decision.preventDefault && decision.actions.length === 0) return;
      if (decision.preventDefault) event.preventDefault();
      for (const action of decision.actions) dispatch(action);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, dispatch]);
}
