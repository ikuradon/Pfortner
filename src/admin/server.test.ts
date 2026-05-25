import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { type AdminState, createAdminHandler } from './server.ts';
import type { ManagedConnection } from '../connections/types.ts';

function makeManagedConnection(id: string): ManagedConnection {
  return {
    info: { connectionId: id, connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    sendNotice: async () => {},
    close: () => {},
    sendAuthChallenge: () => {},
  };
}

const makeState = (): AdminState => ({
  config: {
    server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
    admin: { enabled: true, port: 9091, auth_token: 'test-token' },
    pipelines: { client: [{ policy: 'accept' }], server: [{ policy: 'accept' }] },
  },
  pluginNames: ['accept', 'kind-filter', 'write-guard'],
  connections: new Map<string, ManagedConnection>(),
  blacklist: { pubkeys: new Set<string>(), ips: new Set<string>() },
});

function makeRequest(path: string, method = 'GET', token = 'test-token', body?: string): Request {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(`http://localhost:9091${path}`, { method, headers, body });
}

Deno.test('admin GET /health returns 200', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/health'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'ok');
});

Deno.test('admin rejects missing token', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(new Request('http://localhost:9091/health'));
  assertEquals(res.status, 401);
});

Deno.test('admin rejects wrong token', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/health', 'GET', 'wrong-token'));
  assertEquals(res.status, 401);
});

Deno.test('admin auth uses updated state config token', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);

  state.config = {
    ...state.config,
    admin: { enabled: true, port: 9091, auth_token: 'rotated-token' },
  };

  const oldRes = await handler(makeRequest('/health'));
  const newRes = await handler(makeRequest('/health', 'GET', 'rotated-token'));

  assertEquals(oldRes.status, 401);
  assertEquals(newRes.status, 200);
});

Deno.test('admin GET /config returns masked config', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/config'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.admin.auth_token, '***');
});

Deno.test('admin GET /plugins returns plugin list', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/plugins'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.plugins.length, 3);
});

Deno.test('admin GET /connections returns empty list', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/connections'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.connections.length, 0);
});

Deno.test('admin POST /blacklist/pubkey adds pubkey', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/blacklist/pubkey', 'POST', 'test-token', JSON.stringify({ pubkey: 'pk1' })));
  assertEquals(res.status, 200);
  assertEquals(state.blacklist.pubkeys.has('pk1'), true);
});

Deno.test('admin DELETE /blacklist/pubkey/:pk removes pubkey', async () => {
  const state = makeState();
  state.blacklist.pubkeys.add('pk1');
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/blacklist/pubkey/pk1', 'DELETE'));
  assertEquals(res.status, 200);
  assertEquals(state.blacklist.pubkeys.has('pk1'), false);
});

Deno.test('admin POST /blacklist/ip adds IP', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/blacklist/ip', 'POST', 'test-token', JSON.stringify({ ip: '1.2.3.4' })));
  assertEquals(res.status, 200);
  assertEquals(state.blacklist.ips.has('1.2.3.4'), true);
});

Deno.test('admin returns 404 for unknown path', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/unknown'));
  assertEquals(res.status, 404);
});

Deno.test('admin POST /reload calls reloadFn', async () => {
  let reloaded = false;
  const state = makeState();
  state.configPath = '/tmp/test.yaml';
  state.reloadFn = () => {
    reloaded = true;
    return Promise.resolve();
  };
  // Write a temp file so readTextFile succeeds
  await Deno.writeTextFile('/tmp/test.yaml', 'dummy: true');
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/reload', 'POST'));
  assertEquals(res.status, 200);
  assertEquals(reloaded, true);
});

Deno.test('admin GET /health/detail returns detailed health', async () => {
  const state = makeState();
  state.startTime = Date.now() - 3600000;
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/health/detail'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(typeof body.uptime_seconds, 'number');
  assertEquals(typeof body.connections.active, 'number');
  assertEquals(typeof body.memory, 'object');
});

Deno.test('admin POST /shutdown triggers shutdown', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    isDraining: () => false,
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
    start: () => {},
  } as any;
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/shutdown', 'POST'));
  assertEquals(res.status, 200);
  assertEquals(shutdownCalled, true);
});

Deno.test('admin DELETE /connections/:id calls close', async () => {
  const state = makeState();
  let closed = false;
  state.connections.set('conn-1', {
    info: { connectionId: 'conn-1', connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    sendNotice: async () => {},
    close: () => {
      closed = true;
    },
    sendAuthChallenge: () => {},
  });
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/connections/conn-1', 'DELETE'));
  assertEquals(res.status, 200);
  assertEquals(closed, true);
  const body = await res.json();
  assertEquals(body.closing, 'conn-1');
});

Deno.test('admin POST /connections/disconnect-batch closes multiple', async () => {
  const state = makeState();
  let closedCount = 0;
  state.connections.set('c1', {
    info: { connectionId: 'c1', connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    sendNotice: async () => {},
    close: () => {
      closedCount++;
    },
    sendAuthChallenge: () => {},
  });
  state.connections.set('c2', {
    info: { connectionId: 'c2', connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    sendNotice: async () => {},
    close: () => {
      closedCount++;
    },
    sendAuthChallenge: () => {},
  });
  const handler = createAdminHandler(state);
  const res = await handler(
    makeRequest('/connections/disconnect-batch', 'POST', 'test-token', JSON.stringify({ ids: ['c1', 'c2', 'c3'] })),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.closed.length, 2);
  assertEquals(body.notFound, ['c3']);
  assertEquals(closedCount, 2);
});

Deno.test('admin GET /metrics/throughput returns data', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/metrics/throughput'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(Array.isArray(body), true);
});

Deno.test('admin GET /connections returns info not managed objects', async () => {
  const state = makeState();
  state.connections.set('conn-1', makeManagedConnection('conn-1'));
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/connections'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.connections.length, 1);
  assertEquals(body.connections[0].connectionId, 'conn-1');
  // Should not expose functions
  assertEquals(typeof body.connections[0].close, 'undefined');
});
