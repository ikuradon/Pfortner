import type { ManagedConnection } from '../connections/types.ts';
import type { AdminServiceState } from './state.ts';

export interface AdminConnectionDto {
  id: string;
  ip: string;
  authenticated: boolean;
  pubkey: string;
  connectedAt: string | null;
}

export function toAdminConnectionDto(managed: ManagedConnection): AdminConnectionDto {
  return {
    id: managed.info.connectionId,
    ip: managed.clientIp || managed.info.connectionIpAddr || '',
    authenticated: managed.info.clientAuthorized,
    pubkey: managed.info.clientPubkey,
    connectedAt: managed.connectedAt ?? null,
  };
}

export function getConnections(state: AdminServiceState): AdminConnectionDto[] {
  return [...state.connections.values()].map(toAdminConnectionDto);
}

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
