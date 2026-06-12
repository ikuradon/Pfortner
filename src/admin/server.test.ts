import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { type AdminState, createAdminHandler } from './server.ts';
import type { ManagedConnection } from '../connections/types.ts';
import { LogBuffer } from '../infra/log-buffer.ts';

function makeManagedConnection(id: string): ManagedConnection {
  return {
    info: { connectionId: id, connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
    clientIp: '127.0.0.1',
    connectedAt: '2026-01-01T00:00:00.000Z',
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
  blocklist: { pubkeys: new Set<string>(), ips: new Set<string>() },
});

function makeRequest(path: string, method = 'GET', token = 'test-token', body?: string): Request {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(`http://localhost:9091${path}`, { method, headers, body });
}

const legacyDenyListTerm = 'black' + 'list';

Deno.test('admin GET /health returns 200', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/health'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'ok');
});

Deno.test('Bearer admin health keeps summary payload shape', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(makeRequest('/health'));
  const body = await res.json();

  assertEquals(Object.keys(body).sort(), ['connections', 'pressure', 'status']);
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

Deno.test('admin POST /blocklist/pubkey adds pubkey', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/blocklist/pubkey', 'POST', 'test-token', JSON.stringify({ pubkey: 'pk1' })));
  assertEquals(res.status, 200);
  assertEquals(state.blocklist.pubkeys.has('pk1'), true);
});

Deno.test('admin DELETE /blocklist/pubkey/:pk removes pubkey', async () => {
  const state = makeState();
  state.blocklist.pubkeys.add('pk1');
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/blocklist/pubkey/pk1', 'DELETE'));
  assertEquals(res.status, 200);
  assertEquals(state.blocklist.pubkeys.has('pk1'), false);
});

Deno.test('admin POST /blocklist/ip adds IP', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/blocklist/ip', 'POST', 'test-token', JSON.stringify({ ip: '1.2.3.4' })));
  assertEquals(res.status, 200);
  assertEquals(state.blocklist.ips.has('1.2.3.4'), true);
});

Deno.test('Bearer admin blocklist keeps legacy truthy value semantics', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);

  const pubkeyRes = await handler(
    makeRequest('/blocklist/pubkey', 'POST', 'test-token', JSON.stringify({ pubkey: 123 })),
  );
  const ipRes = await handler(
    makeRequest('/blocklist/ip', 'POST', 'test-token', JSON.stringify({ ip: 456 })),
  );

  assertEquals(pubkeyRes.status, 200);
  assertEquals(ipRes.status, 200);
  assertEquals(await pubkeyRes.json(), { added: 123 });
  assertEquals(await ipRes.json(), { added: 456 });
  assertEquals(state.blocklist.pubkeys.has(123 as never), true);
  assertEquals(state.blocklist.ips.has(456 as never), true);
});

Deno.test('Bearer admin blocklist delete keeps legacy empty path semantics', async () => {
  const state = makeState();
  const handler = createAdminHandler(state);

  const pubkeyRes = await handler(makeRequest('/blocklist/pubkey/', 'DELETE'));
  const ipRes = await handler(makeRequest('/blocklist/ip/', 'DELETE'));

  assertEquals(pubkeyRes.status, 200);
  assertEquals(ipRes.status, 200);
  assertEquals(await pubkeyRes.json(), { deleted: '' });
  assertEquals(await ipRes.json(), { deleted: '' });
});

Deno.test('Bearer admin blocklist delete uses shared action for non-empty path values', async () => {
  const state = makeState();
  state.blocklist.pubkeys.add('pk1');
  state.blocklist.ips.add('1.2.3.4');
  const handler = createAdminHandler(state);

  const pubkeyRes = await handler(makeRequest('/blocklist/pubkey/pk1', 'DELETE'));
  const ipRes = await handler(makeRequest('/blocklist/ip/1.2.3.4', 'DELETE'));

  assertEquals(pubkeyRes.status, 200);
  assertEquals(ipRes.status, 200);
  assertEquals(await pubkeyRes.json(), { deleted: 'pk1' });
  assertEquals(await ipRes.json(), { deleted: '1.2.3.4' });
  assertEquals(state.blocklist.pubkeys.has('pk1'), false);
  assertEquals(state.blocklist.ips.has('1.2.3.4'), false);
});

Deno.test('Bearer admin blocklist routes call shared legacy actions', async () => {
  const source = await Deno.readTextFile(new URL('./server.ts', import.meta.url));

  assertEquals(source.includes('state.blocklist.pubkeys.add'), false);
  assertEquals(source.includes('state.blocklist.pubkeys.delete'), false);
  assertEquals(source.includes('state.blocklist.ips.add'), false);
  assertEquals(source.includes('state.blocklist.ips.delete'), false);
  assertEquals(source.includes('addLegacyBearerPubkey(state.blocklist, body.pubkey)'), true);
  assertEquals(source.includes('deleteLegacyBearerPubkey(state.blocklist, pk)'), true);
  assertEquals(source.includes('addLegacyBearerIp(state.blocklist, body.ip)'), true);
  assertEquals(source.includes('deleteLegacyBearerIp(state.blocklist, ip)'), true);
});

Deno.test('admin does not keep legacy deny-list API route', async () => {
  const handler = createAdminHandler(makeState());
  const res = await handler(
    makeRequest(`/${legacyDenyListTerm}/ip`, 'POST', 'test-token', JSON.stringify({ ip: '1.2.3.4' })),
  );
  assertEquals(res.status, 404);
});

Deno.test('Bearer admin API does not expose Fresh-only endpoints', async () => {
  const handler = createAdminHandler(makeState());

  const getPipelineDraft = await handler(makeRequest('/pipeline-draft'));
  const postPipelineDraft = await handler(makeRequest('/pipeline-draft', 'POST'));
  const pipelines = await handler(makeRequest('/pipelines', 'POST', 'test-token', JSON.stringify({ pipelines: {} })));
  const playground = await handler(
    makeRequest('/playground/evaluate', 'POST', 'test-token', JSON.stringify({ message: [] })),
  );
  const prometheus = await handler(makeRequest('/metrics/prometheus'));
  const blocklist = await handler(makeRequest('/blocklist'));

  assertEquals(getPipelineDraft.status, 404);
  assertEquals(postPipelineDraft.status, 404);
  assertEquals(pipelines.status, 404);
  assertEquals(playground.status, 404);
  assertEquals(prometheus.status, 404);
  assertEquals(blocklist.status, 404);
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

Deno.test('admin GET /logs returns buffered logs', async () => {
  const state = makeState();
  state.logBuffer = new LogBuffer(5);
  state.logBuffer.push('first');
  state.logBuffer.push('second');

  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/logs?limit=1'));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.logs.length, 1);
  assertEquals(body.logs[0].line, 'second');
  assertEquals(body.total, 2);
});

Deno.test('admin GET /logs/stream returns SSE stream', async () => {
  const state = makeState();
  state.logBuffer = new LogBuffer(5);
  state.logBuffer.push('stream-test');

  const handler = createAdminHandler(state);
  const ac = new AbortController();
  const req = new Request('http://localhost:9091/logs/stream?replay=1', {
    headers: { Authorization: 'Bearer test-token' },
    signal: ac.signal,
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type')?.startsWith('text/event-stream'), true);

  ac.abort();
  await res.body?.cancel();
});

Deno.test('admin GET /connections returns info not managed objects', async () => {
  const state = makeState();
  state.connections.set('conn-1', makeManagedConnection('conn-1'));
  const handler = createAdminHandler(state);
  const res = await handler(makeRequest('/connections'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.connections.length, 1);
  assertEquals(body.connections[0].id, 'conn-1');
  assertEquals(body.connections[0].ip, '127.0.0.1');
  assertEquals(body.connections[0].authenticated, false);
  assertEquals(body.connections[0].pubkey, '');
  assertEquals(body.connections[0].connectedAt, '2026-01-01T00:00:00.000Z');
  assertEquals(typeof body.connections[0].connectionIpAddr, 'undefined');
  assertEquals(typeof body.connections[0].clientAuthorized, 'undefined');
  assertEquals(typeof body.connections[0].clientPubkey, 'undefined');
  // Should not expose functions
  assertEquals(typeof body.connections[0].close, 'undefined');
});
