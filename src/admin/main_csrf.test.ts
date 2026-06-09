import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createAdminApp } from '../../admin/main.ts';
import type { AdminState } from './server.ts';

const makeState = (adminOverrides: Partial<NonNullable<AdminState['config']['admin']>> = {}): AdminState => ({
  config: {
    server: { port: 3000, upstream_relay: 'ws://localhost:7777' },
    admin: { enabled: true, auth_token: 'test-token', ...adminOverrides },
    pipelines: { client: [], server: [] },
  },
  pluginNames: [],
  connections: new Map(),
  blocklist: { pubkeys: new Set(), ips: new Set() },
});

Deno.test('Fresh admin rejects cross-origin cookie POST to shutdown', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://admin.example.com/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        Origin: 'https://evil.example.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 403);
  assertEquals(shutdownCalled, false);
});

Deno.test('Fresh admin accepts same-origin cookie POST to shutdown', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://admin.example.com/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        Origin: 'http://admin.example.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 302);
  assertEquals(shutdownCalled, true);
});

Deno.test('Fresh admin accepts forwarded HTTPS origin for cookie POST', async () => {
  let shutdownCalled = false;
  const state = makeState({ trust_proxy: true });
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://127.0.0.1/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        Origin: 'https://admin.example.com',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'admin.example.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 302);
  assertEquals(shutdownCalled, true);
});

Deno.test('Fresh admin accepts RFC Forwarded origin for cookie POST', async () => {
  let shutdownCalled = false;
  const state = makeState({ trust_proxy: true });
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://127.0.0.1/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        Origin: 'https://admin.example.com',
        Forwarded: 'for=192.0.2.60;proto=https;host=admin.example.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 302);
  assertEquals(shutdownCalled, true);
});

Deno.test('Fresh admin rejects forged forwarded origin when proxy trust is disabled', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('https://admin.example.com/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        Origin: 'https://malicious.example.com',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'malicious.example.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 403);
  assertEquals(shutdownCalled, false);
});

Deno.test('Fresh admin accepts same-origin referer fallback for cookie POST', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://admin.example.com/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        Referer: 'http://admin.example.com/admin/',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 302);
  assertEquals(shutdownCalled, true);
});

Deno.test('Fresh admin accepts Sec-Fetch-Site same-origin for cookie POST', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://admin.example.com/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 302);
  assertEquals(shutdownCalled, true);
});

Deno.test('Fresh admin rejects Sec-Fetch-Site none without origin evidence', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://admin.example.com/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Cookie: 'pfortner_admin_token=test-token',
        'Sec-Fetch-Site': 'none',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
  );

  assertEquals(res.status, 403);
  assertEquals(shutdownCalled, false);
});

Deno.test('Fresh admin accepts bearer POST without browser origin headers', async () => {
  let shutdownCalled = false;
  const state = makeState();
  state.shutdownManager = {
    initiateShutdown: () => {
      shutdownCalled = true;
      return Promise.resolve();
    },
  } as AdminState['shutdownManager'];

  const handler = createAdminApp(state);
  const res = await handler(
    new Request('http://admin.example.com/admin/api/shutdown', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
      },
    }),
  );

  assertEquals(res.status, 302);
  assertEquals(shutdownCalled, true);
});
