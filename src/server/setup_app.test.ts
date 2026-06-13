import { assertEquals } from '@std/assert';
import { ensureDataDirLayout } from './data_dir.ts';
import { createSetupHandler } from './setup_app.ts';

Deno.test('setup handler serves setup page on /admin', async () => {
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({ layout, runtime: { backend: { kvAvailable: true, redisAvailable: false } } });
  const res = await handler(new Request('http://localhost/admin'));
  assertEquals(res.status, 200);
  assertEquals((await res.text()).includes('Pfortner Setup'), true);
});

Deno.test('setup handler serves setup page on /admin/', async () => {
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({ layout, runtime: { backend: { kvAvailable: true, redisAvailable: false } } });
  const res = await handler(new Request('http://localhost/admin/'));
  assertEquals(res.status, 200);
  assertEquals((await res.text()).includes('Pfortner Setup'), true);
});

Deno.test('setup handler saves complete config', async () => {
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({ layout, runtime: { backend: { kvAvailable: true, redisAvailable: false } } });
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
  assertEquals(res.status, 303);
  assertEquals(await Deno.readTextFile(layout.configPath).then((text) => text.includes('pipelines:')), true);
});

Deno.test('setup handler rejects invalid upstream relay without creating config', async () => {
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({ layout, runtime: { backend: { kvAvailable: true, redisAvailable: false } } });
  const res = await handler(
    new Request('http://localhost/admin/setup', {
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
  const layout = await ensureDataDirLayout(await Deno.makeTempDir());
  const handler = createSetupHandler({ layout, runtime: { backend: { kvAvailable: true, redisAvailable: false } } });
  const res = await handler(
    new Request('http://localhost/admin/setup', {
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
