import { assertEquals } from '@std/assert';
import type { PfortnerConfig } from '../config/loader.ts';
import { createMainHandler } from './handler.ts';

Deno.test('main handler returns setup_required health in setup mode', async () => {
  const handler = createMainHandler({
    mode: 'setup',
    setupHandler: () => Promise.resolve(new Response('setup')),
  });
  const res = await handler(new Request('http://localhost/health'), fakeConn());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: 'setup_required' });
});

Deno.test('main handler delegates /admin to setup handler in setup mode', async () => {
  const handler = createMainHandler({
    mode: 'setup',
    setupHandler: () => Promise.resolve(new Response('setup ok')),
  });
  const res = await handler(new Request('http://localhost/admin'), fakeConn());
  assertEquals(await res.text(), 'setup ok');
});

Deno.test('main handler returns setup_required for websocket before config exists', async () => {
  const handler = createMainHandler({
    mode: 'setup',
    setupHandler: () => Promise.resolve(new Response('setup')),
  });
  const res = await handler(new Request('http://localhost/', { headers: { upgrade: 'websocket' } }), fakeConn());
  assertEquals(res.status, 503);
  assertEquals(await res.text(), 'setup_required');
});

Deno.test('main handler uses latest config for NIP-11 relay info', async () => {
  let currentConfig = makeConfig('First Relay', 'first description');
  const handler = createMainHandler({
    mode: 'normal',
    config: () => currentConfig,
    adminEnabled: false,
    health: () => ({ status: 'ok' }),
    relayHandler: () => new Response('relay'),
  });

  const first = await handler(nip11Request(), fakeConn());
  assertEquals((await first.json()).name, 'First Relay');

  currentConfig = makeConfig('Second Relay', 'second description');
  const second = await handler(nip11Request(), fakeConn());
  assertEquals(await second.json(), {
    name: 'Second Relay',
    description: 'second description',
    software: 'pfortner',
    supported_nips: [1, 42],
  });
});

function nip11Request(): Request {
  return new Request('http://localhost/', { headers: { accept: 'application/nostr+json' } });
}

function makeConfig(name: string, description: string): PfortnerConfig {
  return {
    server: { port: 3000, upstream_relay: 'ws://127.0.0.1:1' },
    relay_info: { name, description },
    pipelines: { client: [{ policy: 'accept' }], server: [{ policy: 'accept' }] },
  };
}

function fakeConn(): Deno.ServeHandlerInfo<Deno.NetAddr> {
  return { remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 12345 } } as Deno.ServeHandlerInfo<
    Deno.NetAddr
  >;
}
