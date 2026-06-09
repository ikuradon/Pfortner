import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { registerAdminApiRoutes } from './api_routes.ts';
import type { AdminRouteApp, AdminRouteContext, AdminRouteHandler } from './route_types.ts';
import type { AdminState } from '../src/admin/server.ts';

class RecordedRoutes implements AdminRouteApp {
  readonly getRoutes = new Map<string, AdminRouteHandler>();
  readonly postRoutes = new Map<string, AdminRouteHandler>();
  readonly deleteRoutes = new Map<string, AdminRouteHandler>();

  get(path: string, handler: AdminRouteHandler): void {
    this.getRoutes.set(path, handler);
  }

  post(path: string, handler: AdminRouteHandler): void {
    this.postRoutes.set(path, handler);
  }

  delete(path: string, handler: AdminRouteHandler): void {
    this.deleteRoutes.set(path, handler);
  }
}

const makeState = (): AdminState => ({
  config: {
    server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
    admin: { enabled: true, auth_token: 'test-token' },
    pipelines: { client: [{ policy: 'accept' }], server: [{ policy: 'accept' }] },
  },
  pluginNames: ['accept'],
  connections: new Map(),
  blocklist: { pubkeys: new Set<string>(), ips: new Set<string>() },
});

function makeContext(path: string, init?: RequestInit, params: Record<string, string> = {}): AdminRouteContext {
  return {
    req: new Request(`http://localhost:3000${path}`, init),
    params,
  };
}

Deno.test('API route registrar registers expected admin API surface', () => {
  const app = new RecordedRoutes();
  registerAdminApiRoutes(app, '/admin', makeState());

  assertEquals(app.getRoutes.has('/admin/api/health'), true);
  assertEquals(app.getRoutes.has('/admin/api/connections'), true);
  assertEquals(app.getRoutes.has('/admin/api/logs/stream'), true);
  assertEquals(app.postRoutes.has('/admin/api/playground/evaluate'), true);
  assertEquals(app.postRoutes.has('/admin/api/blocklist/ip'), true);
  assertEquals(app.deleteRoutes.has('/admin/api/blocklist/pubkey/:pk'), true);
});

Deno.test('API route registrar blocklist handlers mutate runtime state', async () => {
  const app = new RecordedRoutes();
  const state = makeState();
  registerAdminApiRoutes(app, '/admin', state);

  const addIp = await app.postRoutes.get('/admin/api/blocklist/ip')!(
    makeContext('/admin/api/blocklist/ip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: '203.0.113.10' }),
    }),
  );
  const addPubkey = await app.postRoutes.get('/admin/api/blocklist/pubkey')!(
    makeContext('/admin/api/blocklist/pubkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: 'pk-blocked' }),
    }),
  );
  const deletePubkey = await app.deleteRoutes.get('/admin/api/blocklist/pubkey/:pk')!(
    makeContext('/admin/api/blocklist/pubkey/pk-blocked', undefined, { pk: 'pk-blocked' }),
  );

  assertEquals(addIp.status, 200);
  assertEquals(addPubkey.status, 200);
  assertEquals(deletePubkey.status, 200);
  assertEquals(state.blocklist.ips.has('203.0.113.10'), true);
  assertEquals(state.blocklist.pubkeys.has('pk-blocked'), false);
});
