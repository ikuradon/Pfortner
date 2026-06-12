import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { closeConnectionBatch, getConnections } from './connections.ts';
import type { AdminServiceState } from './state.ts';
import type { ManagedConnection } from '../connections/types.ts';

function mockConn(id: string, clientIp = ''): ManagedConnection {
  return {
    info: {
      connectionId: id,
      connectionIpAddr: '198.51.100.10',
      clientAuthorized: true,
      clientPubkey: 'pk1',
    },
    clientIp,
    connectedAt: '2026-01-01T00:00:00.000Z',
    sendNotice: async () => {},
    close: () => {},
    sendAuthChallenge: () => {},
  };
}

function makeState(): AdminServiceState {
  return {
    config: {
      server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
      pipelines: { client: [], server: [] },
    },
    pluginNames: ['accept'],
    connections: new Map(),
    blocklist: { pubkeys: new Set(), ips: new Set() },
  };
}

Deno.test('admin connection service prefers managed clientIp and falls back to connection info IP', () => {
  const state = makeState();
  state.connections.set('direct', mockConn('direct', '203.0.113.20'));
  state.connections.set('fallback', mockConn('fallback'));

  const conns = getConnections(state);

  assertEquals(conns.map((conn: { id: string }) => conn.id), ['direct', 'fallback']);
  assertEquals(conns[0].ip, '203.0.113.20');
  assertEquals(conns[1].ip, '198.51.100.10');
});

Deno.test('admin connection service closes batches without hiding misses', () => {
  const state = makeState();
  let closed = 0;
  state.connections.set('c1', { ...mockConn('c1'), close: () => closed++ });

  const result = closeConnectionBatch(state, ['c1', 'missing']);

  assertEquals(closed, 1);
  assertEquals(result, { closed: ['c1'], notFound: ['missing'] });
});

Deno.test('admin connection read model lives outside the compatibility facade', async () => {
  const readModel = await import('./read_models/connections.ts') as Record<string, unknown>;
  assertEquals(typeof readModel.getConnections, 'function');
  assertEquals(typeof readModel.closeConnectionBatch, 'undefined');
});

Deno.test('admin connection actions live outside the compatibility facade', async () => {
  const actions = await import('./actions/connections.ts');
  assertEquals(typeof actions.closeConnectionBatch, 'function');
});
