import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createAdminApp } from './main.ts';
import type { AdminState } from '../src/admin/server.ts';
import type { ManagedConnection } from '../src/connections/types.ts';
import { LogBuffer } from '../src/infra/log-buffer.ts';

const makeState = (): AdminState => ({
  config: {
    server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
    admin: { enabled: true, auth_token: 'test-token' },
    pipelines: {
      client: [{ policy: 'accept' }],
      server: [{ policy: 'accept' }],
    },
  },
  pluginNames: ['accept'],
  connections: new Map<string, ManagedConnection>(),
  blocklist: { pubkeys: new Set<string>(), ips: new Set<string>() },
});

function makeManagedConnection(id: string): ManagedConnection {
  return {
    info: {
      connectionId: id,
      connectionIpAddr: '198.51.100.10',
      clientAuthorized: true,
      clientPubkey: 'pk1',
    },
    clientIp: '198.51.100.10',
    connectedAt: '2026-01-01T00:00:00.000Z',
    sendNotice: async () => {},
    close: () => {},
    sendAuthChallenge: () => {},
  };
}

function makeRequest(path: string, token: string): Request {
  return new Request(`http://localhost:3000${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function makeJsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const legacyDenyListTerm = 'black' + 'list';

Deno.test('admin app auth uses updated state config token', async () => {
  const state = makeState();
  const handler = createAdminApp(state);

  state.config = {
    ...state.config,
    admin: { enabled: true, auth_token: 'rotated-token' },
  };

  const oldRes = await handler(makeRequest('/admin/api/health', 'test-token'));
  const newRes = await handler(
    makeRequest('/admin/api/health', 'rotated-token'),
  );

  assertEquals(oldRes.status, 401);
  assertEquals(newRes.status, 200);
});

Deno.test('admin app redirects /admin to /admin/', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin', 'test-token'));

  assertEquals(res.status, 302);
  assertEquals(res.headers.get('Location'), '/admin/');
});

Deno.test('admin app page routes render Fresh SSR pages with partial navigation', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/blocklist', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes('f-client-nav="true"'), true);
  assertEquals(html.includes('frsh:partial:admin-sidebar'), true);
  assertEquals(html.includes('frsh:partial:admin-content'), true);
  const removedEmptyFreshBootImport = 'import { boot } from ' + '"";';
  assertEquals(html.includes(removedEmptyFreshBootImport), false);
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('Blocklist'), true);
  assertEquals(html.includes('/admin/static/blocklist.js'), true);
  const removedSpaBootScript = '/admin/static/' + 'app.js';
  assertEquals(html.includes(removedSpaBootScript), false);
  assertEquals(html.includes('id="admin-app"'), false);
  assertEquals(html.includes(`/admin/static/${legacyDenyListTerm}.js`), false);
});

Deno.test('admin app does not keep legacy deny-list page route', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(
    makeRequest(`/admin/${legacyDenyListTerm}`, 'test-token'),
  );

  assertEquals(res.status, 404);
});

Deno.test('admin app does not keep standalone playground page route', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/playground', 'test-token'));

  assertEquals(res.status, 404);
});

Deno.test('admin app static JavaScript requires revalidation', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(
    makeRequest('/admin/static/dashboard.js?v=test', 'test-token'),
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'no-cache');
});

Deno.test('admin app GET /admin/api/connections returns connection DTOs', async () => {
  const state = makeState();
  state.connections.set('conn-1', makeManagedConnection('conn-1'));
  const handler = createAdminApp(state);

  const res = await handler(
    makeRequest('/admin/api/connections', 'test-token'),
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.connections, [{
    id: 'conn-1',
    ip: '198.51.100.10',
    authenticated: true,
    pubkey: 'pk1',
    connectedAt: '2026-01-01T00:00:00.000Z',
  }]);
});

Deno.test('admin app blocklist API updates runtime sets', async () => {
  const state = makeState();
  const handler = createAdminApp(state);

  const addIp = await handler(
    makeJsonRequest('/admin/api/blocklist/ip', 'POST', { ip: '203.0.113.10' }),
  );
  const addPubkey = await handler(
    makeJsonRequest('/admin/api/blocklist/pubkey', 'POST', {
      pubkey: 'pk-blocked',
    }),
  );
  const get = await handler(makeRequest('/admin/api/blocklist', 'test-token'));

  assertEquals(addIp.status, 200);
  assertEquals(addPubkey.status, 200);
  assertEquals(state.blocklist.ips.has('203.0.113.10'), true);
  assertEquals(state.blocklist.pubkeys.has('pk-blocked'), true);
  assertEquals(await get.json(), {
    pubkeys: ['pk-blocked'],
    ips: ['203.0.113.10'],
  });
});

Deno.test('admin app does not keep legacy deny-list API route', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(
    makeRequest(`/admin/api/${legacyDenyListTerm}`, 'test-token'),
  );

  assertEquals(res.status, 404);
});

Deno.test('admin app GET /admin/api/logs returns buffered logs', async () => {
  const state = makeState();
  state.logBuffer = new LogBuffer(5);
  state.logBuffer.push('fresh-log');
  const handler = createAdminApp(state);

  const res = await handler(
    makeRequest('/admin/api/logs?limit=1', 'test-token'),
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.logs.length, 1);
  assertEquals(body.logs[0].line, 'fresh-log');
});

Deno.test('admin app GET /admin/api/logs/stream returns SSE stream', async () => {
  const state = makeState();
  state.logBuffer = new LogBuffer(5);
  state.logBuffer.push('fresh-stream-log');
  const handler = createAdminApp(state);
  const ac = new AbortController();
  const req = new Request(
    'http://localhost:3000/admin/api/logs/stream?replay=1',
    {
      headers: { Authorization: 'Bearer test-token' },
      signal: ac.signal,
    },
  );

  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get('Content-Type')?.startsWith('text/event-stream'),
    true,
  );

  ac.abort();
  await res.body?.cancel();
});
