import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { loadConfigFromString } from './loader.ts';
import { evaluateRuntimeGuards } from './runtime-guards.ts';

const makeConfig = (trustForwarded = false) =>
  loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
  x_forwarded_for: ${trustForwarded}
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);

const conn = {
  remoteAddr: { hostname: '127.0.0.1', port: 12345, transport: 'tcp' as const },
};

Deno.test('runtime guards select trusted forwarded IP before blocklist checks', () => {
  const req = new Request('http://localhost/', {
    headers: { 'X-Forwarded-For': '198.51.100.10, 10.0.0.5' },
  });

  const result = evaluateRuntimeGuards({
    config: makeConfig(true),
    hooks: {
      blocklist: {
        pubkeys: new Set(),
        ips: new Set(['198.51.100.10']),
      },
    },
    req,
    conn: conn as Deno.ServeHandlerInfo<Deno.NetAddr>,
  });

  assertEquals(result.clientIp, '198.51.100.10');
  assertEquals(result.response?.status, 403);
});

Deno.test('runtime guards return connection pressure rejection before session creation', async () => {
  const result = evaluateRuntimeGuards({
    config: makeConfig(),
    hooks: {
      connectionManager: {
        canAccept: (_ip: string) => ({ allowed: false, reason: 'busy', statusCode: 429 }),
        register: () => {},
        unregister: () => {},
        getStats: () => ({ active: 0, authenticated: 0, max: 1, perIpMax: 1, pressure: 'critical' as const }),
      } as any,
    },
    req: new Request('http://localhost/'),
    conn: conn as Deno.ServeHandlerInfo<Deno.NetAddr>,
  });

  assertEquals(result.clientIp, '127.0.0.1');
  assertEquals(result.response?.status, 429);
  assertEquals(await result.response?.text(), 'busy');
});

Deno.test('runtime guards use explicit trustProxy option instead of config.server.x_forwarded_for', () => {
  const config = makeConfig(false);
  const req = new Request('http://localhost/', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  });
  const conn = { remoteAddr: { hostname: '10.0.0.5', port: 1234, transport: 'tcp' } } as Deno.ServeHandlerInfo<
    Deno.NetAddr
  >;

  const result = evaluateRuntimeGuards({ config, req, conn, trustProxy: true });
  assertEquals(result.clientIp, '203.0.113.10');
});

Deno.test('runtime guards allow explicit trustProxy false to override legacy trusted config', () => {
  const config = makeConfig(true);
  const req = new Request('http://localhost/', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  });
  const conn = { remoteAddr: { hostname: '10.0.0.5', port: 1234, transport: 'tcp' } } as Deno.ServeHandlerInfo<
    Deno.NetAddr
  >;

  const result = evaluateRuntimeGuards({ config, req, conn, trustProxy: false });
  assertEquals(result.clientIp, '10.0.0.5');
});
