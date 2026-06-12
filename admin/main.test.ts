import { assertEquals } from '@std/assert';
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

Deno.test('admin main entrypoint delegates to first-class app module', async () => {
  const main = await import('./main.ts');
  const appModule = await import('./app/create_admin_app.ts');

  assertEquals(main.createAdminApp, appModule.createAdminApp);
});

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
  assertEquals(html.includes('id="btn-toggle-sidebar"'), true);
  assertEquals(html.includes('pfortner-sidebar-collapsed'), true);
  const removedEmptyFreshBootImport = 'import { boot } from ' + '"";';
  assertEquals(html.includes(removedEmptyFreshBootImport), false);
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('/admin/static/client.js'), false);
  assertEquals(html.includes('Blocklist'), true);
  assertEquals(html.includes('/admin/static/blocklist.js'), false);
  assertEquals(html.includes('/admin/static/utils.js'), false);
  const removedSpaBootScript = '/admin/static/' + 'app.js';
  assertEquals(html.includes(removedSpaBootScript), false);
  assertEquals(html.includes('id="admin-app"'), false);
  assertEquals(html.includes(`/admin/static/${legacyDenyListTerm}.js`), false);
});

Deno.test('admin config page uses the Fresh client entry without a page-local static script', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/config', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('/admin/static/config.js'), false);
  assertEquals(html.includes('/admin/static/utils.js'), false);
  assertEquals(html.includes('id="config-json"'), true);
  assertEquals(html.includes('id="btn-reload-config"'), true);
});

Deno.test('admin dashboard page uses the Fresh client entry without a page-local static script', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('/admin/static/dashboard.js'), false);
  assertEquals(html.includes('/admin/static/utils.js'), false);
  assertEquals(html.includes('id="stats-cards"'), true);
  assertEquals(html.includes('id="throughput-chart-body"'), true);
});

Deno.test('admin connections page uses the Fresh client entry without a page-local static script', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/connections', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('/admin/static/connections.js'), false);
  assertEquals(html.includes('/admin/static/utils.js'), false);
  assertEquals(html.includes('id="connections-tbody"'), true);
  assertEquals(html.includes('id="btn-disconnect-selected"'), true);
});

Deno.test('admin metrics page uses the Fresh client entry without a page-local static script', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/metrics', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('/admin/static/metrics.js'), false);
  assertEquals(html.includes('/admin/static/utils.js'), false);
  assertEquals(html.includes('id="throughput-chart-body"'), true);
  assertEquals(html.includes('id="raw-metrics-pre"'), true);
});

Deno.test('admin logs page uses the Fresh client entry without a page-local static script', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/logs', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('/admin/static/logs.js'), false);
  assertEquals(html.includes('/admin/static/utils.js'), false);
  assertEquals(html.includes('id="log-viewer"'), true);
  assertEquals(html.includes('id="runtime-info-tbody"'), true);
});

Deno.test('admin app installs Fresh island build cache for admin islands', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/pipelines', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  const removedEmptyFreshBootImport = 'import { boot } from ' + '"";';

  assertEquals(html.includes(removedEmptyFreshBootImport), false);
  assertEquals(html.includes('/admin/static/fresh_nav.js'), true);
  assertEquals(html.includes('/admin/static/islands/PipelineWorkbench.js'), true);
  const removedPipelinesScript = '/admin/static/' + 'pipelines.js';
  const removedPipelinesInitializer = 'init' + 'PipelinesPage';
  assertEquals(html.includes(removedPipelinesScript), false);
  assertEquals(html.includes(removedPipelinesInitializer), false);
  assertEquals(/id="btn-undo-pipeline"[^>]*disabled/.test(html), true);
  assertEquals(/id="btn-redo-pipeline"[^>]*disabled/.test(html), true);
  assertEquals(/id="btn-publish-pipeline"[^>]*disabled/.test(html), false);
  assertEquals(html.includes('frsh:island'), true);
  assertEquals(html.includes('PipelineWorkbench'), true);
  assertEquals(html.includes('rel="icon"'), true);
  assertEquals(html.includes('href="data:,"'), true);

  const chunkRes = await handler(
    makeRequest('/admin/static/islands/PipelineWorkbench.js', 'test-token'),
  );
  assertEquals(chunkRes.status, 200);
  assertEquals(
    chunkRes.headers.get('Content-Type')?.includes('application/javascript'),
    true,
  );
  const chunkText = await chunkRes.text();
  assertEquals(chunkText.includes('mountPipelineWorkbench'), true);
  assertEquals(chunkText.includes('initPipelinesPage'), false);
  assertEquals(chunkText.includes('graphFromRenderedDom'), false);
  assertEquals(chunkText.includes('../pipeline_graph.js'), false);
  assertEquals(chunkText.includes('../pipeline_workbench_state.js'), false);
  assertEquals(chunkText.includes('../pipeline_config_editor.js'), false);
});

Deno.test('admin pipelines page renders legacy workbench canvas controls', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/pipelines', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();

  for (
    const id of [
      'btn-fit-canvas',
      'btn-zoom-in',
      'btn-zoom-out',
      'selection-marquee',
      'minimap-svg',
    ]
  ) {
    assertEquals(
      html.includes(`id="${id}"`) || html.includes(`id='${id}'`),
      true,
      id,
    );
  }
  assertEquals(html.includes('id="btn-run-pipeline"'), false);
  assertEquals(html.includes("id='btn-run-pipeline'"), false);
});

Deno.test('admin pipelines page SSR renders active config graph', async () => {
  const state = makeState();
  state.config = {
    ...state.config,
    pipelines: {
      client: [{ policy: 'accept' }, { policy: 'write-guard' }],
      server: [{ policy: 'rate-limit' }],
    },
  };
  state.pluginNames = ['accept', 'write-guard', 'rate-limit'];
  const handler = createAdminApp(state);
  const res = await handler(makeRequest('/admin/pipelines', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes('data-node-policy="accept"'), true);
  assertEquals(html.includes('data-node-policy="write-guard"'), true);
  assertEquals(html.includes('data-policy="rate-limit"'), true);
});

Deno.test('admin pipelines page renders direction selector in the page header', async () => {
  const handler = createAdminApp(makeState());
  const res = await handler(makeRequest('/admin/pipelines', 'test-token'));

  assertEquals(res.status, 200);
  const html = await res.text();
  const headerIndex = html.indexOf('class="page-header pipeline-page-header"');
  const titleIndex = html.indexOf('class="page-title"');
  const modeBarIndex = html.indexOf('class="pipeline-mode-bar"');
  const toolbarIndex = html.indexOf('class="pipeline-toolbar"');
  const commandBarIndex = html.indexOf('class="workbench-command-bar"');

  assertEquals(headerIndex >= 0, true);
  assertEquals(titleIndex >= 0, true);
  assertEquals(modeBarIndex >= 0, true);
  assertEquals(toolbarIndex >= 0, true);
  assertEquals(commandBarIndex >= 0, true);
  assertEquals(headerIndex < modeBarIndex, true);
  assertEquals(titleIndex < modeBarIndex, true);
  assertEquals(modeBarIndex < commandBarIndex, true);
  assertEquals(commandBarIndex < toolbarIndex, true);
  assertEquals(
    /class="pipeline-toolbar"[\s\S]*id="tab-client"/.test(html),
    false,
  );
  assertEquals(
    /class="pipeline-toolbar"[\s\S]*id="tab-server"/.test(html),
    false,
  );
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
    makeRequest('/admin/static/fresh_nav.js?v=test', 'test-token'),
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'no-cache');
  const source = await res.text();
  assertEquals(source.includes('Generated from admin/client/fresh_nav.js'), true);
  assertEquals(source.includes('export function boot'), true);
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
