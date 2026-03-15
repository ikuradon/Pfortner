import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { type AdminState, createAdminHandler } from './server.ts';

const makeState = (): AdminState => ({
  config: {
    server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
    admin: { enabled: true, port: 9091, auth_token: 'test-token' },
    pipelines: { client: [{ policy: 'accept' }], server: [{ policy: 'accept' }] },
  },
  pluginNames: ['accept', 'kind-filter', 'write-guard'],
  connections: new Map(),
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
