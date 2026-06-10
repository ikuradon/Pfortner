import { assertEquals, assertExists } from '@std/assert';
import { parse as parseYaml } from '@std/yaml';
import { registerAdminApiRoutes } from './api_routes.ts';
import type { AdminRouteApp, AdminRouteContext, AdminRouteHandler } from './route_types.ts';
import { pipelineDraftPathForConfig } from '../src/admin/pipeline_draft.ts';
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
    pipelines: {
      client: [{ policy: 'accept' }],
      server: [{ policy: 'accept' }],
    },
  },
  pluginNames: ['accept'],
  connections: new Map(),
  blocklist: { pubkeys: new Set<string>(), ips: new Set<string>() },
});

function makeContext(
  path: string,
  init?: RequestInit,
  params: Record<string, string> = {},
): AdminRouteContext {
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
  assertEquals(app.postRoutes.has('/admin/api/pipelines'), true);
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
  const deletePubkey = await app.deleteRoutes.get(
    '/admin/api/blocklist/pubkey/:pk',
  )!(
    makeContext('/admin/api/blocklist/pubkey/pk-blocked', undefined, {
      pk: 'pk-blocked',
    }),
  );

  assertEquals(addIp.status, 200);
  assertEquals(addPubkey.status, 200);
  assertEquals(deletePubkey.status, 200);
  assertEquals(state.blocklist.ips.has('203.0.113.10'), true);
  assertEquals(state.blocklist.pubkeys.has('pk-blocked'), false);
});

Deno.test('playground evaluate can use request pipeline instead of server config', async () => {
  const app = new RecordedRoutes();
  const state = makeState();
  registerAdminApiRoutes(app, '/admin', state);

  const res = await app.postRoutes.get('/admin/api/playground/evaluate')!(
    makeContext('/admin/api/playground/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: 'client',
        pipeline: [{ policy: 'kind-filter', config: { allow_kinds: [2] } }],
        message: ['EVENT', { kind: 1 }],
        connectionInfo: {
          authenticated: false,
          pubkey: '',
          clientIp: '127.0.0.1',
        },
      }),
    }),
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.finalAction, 'reject');
  assertEquals(body.steps[0].policy, 'kind-filter');
});

Deno.test('pipeline save route persists posted pipelines and reloads runtime', async () => {
  const app = new RecordedRoutes();
  const state = makeState();
  const configPath = await Deno.makeTempFile({ suffix: '.yaml' });
  let reloadedYaml = '';
  let reloadCalls = 0;
  state.configPath = configPath;
  state.reloadFn = (yaml) => {
    reloadCalls++;
    reloadedYaml = yaml;
    state.config = parseYaml(yaml) as AdminState['config'];
    return Promise.resolve();
  };
  await Deno.writeTextFile(
    configPath,
    'server:\n  port: 3000\n  upstream_relay: ws://localhost:7777\nadmin:\n  enabled: true\n  auth_token: test-token\npipelines:\n  client:\n    - policy: accept\n  server:\n    - policy: accept\n',
  );
  registerAdminApiRoutes(app, '/admin', state);

  const handler = app.postRoutes.get('/admin/api/pipelines');
  assertExists(handler);
  const res = await handler(makeContext('/admin/api/pipelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pipelines: {
        client: [{
          policy: 'kind-filter',
          config: { mode: 'allow', kinds: [1] },
        }],
        server: [{ policy: 'accept' }],
      },
    }),
  }));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'saved');
  assertEquals(reloadCalls, 1);
  assertEquals(reloadedYaml, await Deno.readTextFile(configPath));
  assertEquals(state.config.pipelines.client[0].policy, 'kind-filter');
  assertEquals(state.config.pipelines.client[0].config, {
    mode: 'allow',
    kinds: [1],
  });
  assertEquals(body.pipelines.client[0].policy, 'kind-filter');

  await Deno.remove(configPath);
});

Deno.test('pipeline draft API returns null when draft storage is not configured', async () => {
  const app = new RecordedRoutes();
  const state = makeState();
  registerAdminApiRoutes(app, '/admin', state);

  const handler = app.getRoutes.get('/admin/api/pipeline-draft');
  assertExists(handler);
  const res = await handler(makeContext('/admin/api/pipeline-draft', { method: 'GET' }));

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { draft: null });
});

Deno.test('pipeline draft API saves and reads workbench draft sidecar', async () => {
  const configPath = await Deno.makeTempFile({ suffix: '.yaml' });
  const draftPath = pipelineDraftPathForConfig(configPath);
  const state = makeState();
  state.pipelineDraftPath = draftPath;
  const app = new RecordedRoutes();
  registerAdminApiRoutes(app, '/admin', state);

  const draft = {
    version: 1,
    graphs: {
      client: {
        direction: 'client',
        nodes: [{ id: 'client-start', type: 'start', policy: 'start' }],
        edges: [],
      },
      server: {
        direction: 'server',
        nodes: [{ id: 'server-start', type: 'start', policy: 'start' }],
        edges: [],
      },
    },
    viewports: {
      client: { zoom: 1, pan: { x: 0, y: 0 } },
      server: { zoom: 1, pan: { x: 0, y: 0 } },
    },
    updatedAt: '2026-06-10T00:00:00.000Z',
    lastPublishedFingerprint: '{"client":[],"server":[]}',
  };

  const postHandler = app.postRoutes.get('/admin/api/pipeline-draft');
  assertExists(postHandler);
  const saveRes = await postHandler(makeContext('/admin/api/pipeline-draft', {
    method: 'POST',
    body: JSON.stringify({ draft }),
    headers: { 'Content-Type': 'application/json' },
  }));
  assertEquals(saveRes.status, 200);
  assertEquals((await saveRes.json()).status, 'saved');

  const getHandler = app.getRoutes.get('/admin/api/pipeline-draft');
  assertExists(getHandler);
  const getRes = await getHandler(makeContext('/admin/api/pipeline-draft', { method: 'GET' }));
  assertEquals(getRes.status, 200);
  assertEquals(await getRes.json(), { draft });

  await Deno.remove(configPath);
  await Deno.remove(draftPath);
});
