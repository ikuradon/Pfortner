import type { AdminServiceState } from '../state.ts';

export function closeConnection(state: AdminServiceState, id: string): { found: boolean } {
  const managed = state.connections.get(id);
  if (managed) {
    managed.close();
    return { found: true };
  }
  return { found: false };
}

export function closeConnectionBatch(
  state: AdminServiceState,
  ids: string[],
): { closed: string[]; notFound: string[] } {
  const closed: string[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    const managed = state.connections.get(id);
    if (managed) {
      managed.close();
      closed.push(id);
    } else {
      notFound.push(id);
    }
  }
  return { closed, notFound };
}
