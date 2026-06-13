import { assertEquals, assertRejects } from '@std/assert';
import { ensureDataDirLayout } from './data_dir.ts';
import { createSetupHandler } from './setup_app.ts';
import type { AdminAuthState } from './types.ts';

const adminAuth: AdminAuthState = {
  enabled: true,
  path: '/admin',
  token: 'test-token',
  tokenSource: 'env',
};

async function makeSetupHandler() {
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({
    layout,
    runtime: { backend: { kvAvailable: true, redisAvailable: false } },
    adminAuth,
    trustProxy: false,
  });
  return { layout, handler };
}

function authorizedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer test-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function assertMissing(path: string): Promise<void> {
  await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
}

Deno.test('setup handler serves setup page on /admin', async () => {
  const { handler } = await makeSetupHandler();
  const res = await handler(authorizedRequest('/admin'));
  assertEquals(res.status, 200);
  assertEquals((await res.text()).includes('Pfortner Setup'), true);
});

Deno.test('setup handler serves setup page on /admin/', async () => {
  const { handler } = await makeSetupHandler();
  const res = await handler(authorizedRequest('/admin/'));
  assertEquals(res.status, 200);
  assertEquals((await res.text()).includes('Pfortner Setup'), true);
});

Deno.test('setup handler redirects unauthenticated setup page to login', async () => {
  const { handler } = await makeSetupHandler();
  const res = await handler(new Request('http://localhost/admin/'));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('Location'), '/admin/login?next=%2Fadmin%2F');
});

Deno.test('setup login sets scoped admin cookie for valid token', async () => {
  const { handler } = await makeSetupHandler();
  const res = await handler(
    new Request('http://localhost/admin/login?next=/admin/', {
      method: 'POST',
      body: new URLSearchParams({ token: 'test-token' }),
    }),
  );
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('Location'), '/admin/');
  assertEquals(
    res.headers.get('Set-Cookie'),
    'pfortner_admin_token=test-token; HttpOnly; SameSite=Strict; Path=/admin',
  );
});

Deno.test('setup handler rejects unauthenticated setup save without creating config', async () => {
  const { layout, handler } = await makeSetupHandler();
  const res = await handler(
    new Request('http://localhost/admin/setup', {
      method: 'POST',
      body: new URLSearchParams({
        upstream_relay: 'wss://relay.example.com',
        relay_name: 'Pfortner Relay',
        relay_description: '',
      }),
    }),
  );
  assertEquals(res.status, 401);
  await assertMissing(layout.configPath);
});

Deno.test('setup handler rejects cookie setup save without same-origin evidence', async () => {
  const { layout, handler } = await makeSetupHandler();
  const res = await handler(
    new Request('http://localhost/admin/setup', {
      method: 'POST',
      headers: { Cookie: 'pfortner_admin_token=test-token' },
      body: new URLSearchParams({
        upstream_relay: 'wss://relay.example.com',
        relay_name: 'Pfortner Relay',
        relay_description: '',
      }),
    }),
  );
  assertEquals(res.status, 403);
  await assertMissing(layout.configPath);
});

Deno.test('setup handler saves complete config', async () => {
  const { layout, handler } = await makeSetupHandler();
  const res = await handler(
    authorizedRequest('/admin/setup', {
      method: 'POST',
      body: new URLSearchParams({
        upstream_relay: 'wss://relay.example.com',
        relay_name: 'Pfortner Relay',
        relay_description: '',
      }),
    }),
  );
  assertEquals(res.status, 303);
  assertEquals(await Deno.readTextFile(layout.configPath).then((text) => text.includes('pipelines:')), true);
});

Deno.test('setup handler rejects invalid upstream relay without creating config', async () => {
  const { layout, handler } = await makeSetupHandler();
  const res = await handler(
    authorizedRequest('/admin/setup', {
      method: 'POST',
      body: new URLSearchParams({
        upstream_relay: 'not-a-url',
        relay_name: 'Pfortner Relay',
        relay_description: '',
      }),
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assertEquals((await res.text()).includes('Pfortner Setup'), true);
  await Deno.stat(layout.configPath).then(
    () => {
      throw new Error('config.yaml should not exist');
    },
    (error) => {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    },
  );
});

Deno.test('setup handler empty upstream 400 response is html', async () => {
  const { handler } = await makeSetupHandler();
  const res = await handler(
    authorizedRequest('/admin/setup', {
      method: 'POST',
      body: new URLSearchParams({
        upstream_relay: '',
        relay_name: 'Pfortner Relay',
        relay_description: '',
      }),
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
});
