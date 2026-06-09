import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createAdminApp } from './main.ts';
import type { AdminState } from '../src/admin/server.ts';
import type { ManagedConnection } from '../src/connections/types.ts';
import { LogBuffer } from '../src/infra/log-buffer.ts';

const makeState = (): AdminState => ({
  config: {
    server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
    admin: { enabled: true, auth_token: 'test-token' },
    pipelines: { client: [{ policy: 'accept' }], server: [{ policy: 'accept' }] },
  },
  pluginNames: ['accept'],
  connections: new Map<string, ManagedConnection>(),
  blacklist: { pubkeys: new Set<string>(), ips: new Set<string>() },
});

function makeRequest(path: string, token: string): Request {
  return new Request(`http://localhost:3000${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

Deno.test('admin app auth uses updated state config token', async () => {
  const state = makeState();
  const handler = createAdminApp(state);

  state.config = {
    ...state.config,
    admin: { enabled: true, auth_token: 'rotated-token' },
  };

  const oldRes = await handler(makeRequest('/admin/api/health', 'test-token'));
  const newRes = await handler(makeRequest('/admin/api/health', 'rotated-token'));

  assertEquals(oldRes.status, 401);
  assertEquals(newRes.status, 200);
});

Deno.test('admin app GET /admin/api/logs returns buffered logs', async () => {
  const state = makeState();
  state.logBuffer = new LogBuffer(5);
  state.logBuffer.push('fresh-log');
  const handler = createAdminApp(state);

  const res = await handler(makeRequest('/admin/api/logs?limit=1', 'test-token'));

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
  const req = new Request('http://localhost:3000/admin/api/logs/stream?replay=1', {
    headers: { Authorization: 'Bearer test-token' },
    signal: ac.signal,
  });

  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type')?.startsWith('text/event-stream'), true);

  ac.abort();
  await res.body?.cancel();
});
