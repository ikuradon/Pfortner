import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { closeConnection, closeConnectionBatch, getConnections, getHealthSimple, maskSecrets } from './service.ts';
import type { AdminServiceState } from './service.ts';
import type { ManagedConnection } from '../connections/types.ts';

function mockConn(id: string): ManagedConnection {
  return {
    info: { connectionId: id, connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    sendNotice: async () => {},
    close: () => {},
    sendAuthChallenge: () => {},
  };
}

function makeState(overrides: Partial<AdminServiceState> = {}): AdminServiceState {
  return {
    config: {
      server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
      pipelines: { client: [], server: [] },
    } as any,
    pluginNames: ['accept'],
    connections: new Map(),
    blacklist: { pubkeys: new Set(), ips: new Set() },
    ...overrides,
  };
}

Deno.test('maskSecrets masks auth_token', () => {
  const state = makeState();
  state.config.admin = { enabled: true, auth_token: 'secret' } as any;
  const masked = maskSecrets(state.config) as any;
  assertEquals(masked.admin.auth_token, '***');
});

Deno.test('getHealthSimple returns ok', () => {
  assertEquals(getHealthSimple(makeState()).status, 'ok');
});

Deno.test('getHealthSimple returns draining', () => {
  const state = makeState({ shutdownManager: { isDraining: () => true, initiateShutdown: async () => {} } });
  assertEquals(getHealthSimple(state).status, 'draining');
});

Deno.test('getConnections returns connection info', () => {
  const state = makeState();
  state.connections.set('c1', mockConn('c1'));
  const conns = getConnections(state);
  assertEquals(conns.length, 1);
  assertEquals((conns[0] as any).connectionId, 'c1');
});

Deno.test('closeConnection closes and returns found', () => {
  const state = makeState();
  state.connections.set('c1', mockConn('c1'));
  assertEquals(closeConnection(state, 'c1').found, true);
});

Deno.test('closeConnection returns not found', () => {
  assertEquals(closeConnection(makeState(), 'nonexistent').found, false);
});

Deno.test('closeConnectionBatch closes multiple', () => {
  const state = makeState();
  state.connections.set('c1', mockConn('c1'));
  state.connections.set('c2', mockConn('c2'));
  const result = closeConnectionBatch(state, ['c1', 'c2', 'c3']);
  assertEquals(result.closed.length, 2);
  assertEquals(result.notFound, ['c3']);
});
