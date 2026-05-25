import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createAdminApp } from './main.ts';
import type { AdminState } from '../src/admin/server.ts';
import type { ManagedConnection } from '../src/connections/types.ts';

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
