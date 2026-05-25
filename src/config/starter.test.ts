import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { buildRequestHandler } from './starter.ts';
import { loadConfigFromString } from './loader.ts';
import { buildInfraContext } from '../infra/context.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import { ConnectionManager } from '../connections/manager.ts';
import type { ManagedConnection } from '../connections/types.ts';
import { createInMemoryMetrics } from '../infra/metrics.ts';

Deno.test('buildRequestHandler rejects invalid plugin config', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: rate-limit
      config:
        scope: "invalid-scope"
        window: "not-a-number"
    - policy: accept
  server:
    - policy: accept
`);
  try {
    await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry());
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('validation'), true);
  }
});

Deno.test('buildRequestHandler rejects protected-event without required config', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: accept
  server:
    - policy: protected-event
    - policy: accept
`);
  try {
    await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry());
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes("must have required property 'require_auth'"), true);
  }
});

Deno.test('buildRequestHandler rejects invalid conditional policy config', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: when
      config:
        condition:
          authenticated: true
          or:
            - event_kind: 4
        then:
          - policy: accept
    - policy: accept
  server:
    - policy: accept
`);
  try {
    await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry());
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('validation'), true);
  }
});

Deno.test('buildRequestHandler rejects missing protected-event config', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: accept
  server:
    - policy: protected-event
    - policy: accept
`);
  try {
    await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry());
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('validation'), true);
  }
});

Deno.test('buildRequestHandler rejects missing kind-filter config', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: kind-filter
    - policy: accept
  server:
    - policy: accept
`);
  try {
    await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry());
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('validation'), true);
  }
});

Deno.test('buildRequestHandler creates a function', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
  const handler = await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry());
  assertEquals(typeof handler, 'function');
});

Deno.test('buildRequestHandler validates direction', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: protected-event
      config:
        require_auth: true
  server:
    - policy: accept
`);
  try {
    await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry());
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('direction'), true);
  }
});

Deno.test('buildRequestHandler returns 503 when shutdownManager.isDraining() is true', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
  const mockShutdownManager = {
    isDraining: () => true,
    initiateShutdown: async () => {},
  };
  const handler = await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry(), {
    shutdownManager: mockShutdownManager as any,
  });
  const req = new Request('http://localhost/');
  const conn = { remoteAddr: { hostname: '127.0.0.1', port: 12345, transport: 'tcp' as const } };
  const response = handler(req, conn as any);
  assertEquals(response.status, 503);
});

Deno.test('buildRequestHandler returns 429 when connectionManager.canAccept() returns false', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
  const mockConnectionManager = {
    canAccept: (_ip: string) => ({ allowed: false, reason: 'Too Many Requests', statusCode: 429 }),
    register: () => {},
    unregister: () => {},
    getStats: () => ({ active: 0, authenticated: 0, max: 10, perIpMax: 3, pressure: 'normal' as const }),
  };
  const handler = await buildRequestHandler(config, buildInfraContext({}), createPluginRegistry(), {
    connectionManager: mockConnectionManager as any,
  });
  const req = new Request('http://localhost/');
  const conn = { remoteAddr: { hostname: '127.0.0.1', port: 12345, transport: 'tcp' as const } };
  const response = handler(req, conn as any);
  assertEquals(response.status, 429);
});

Deno.test('buildRequestHandler rejects malformed websocket upgrade without registering connection', async () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
  connections:
    max: 10
    max_per_ip: 1
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
  const connections = new Map<string, ManagedConnection>();
  const connectionManager = new ConnectionManager(connections, {
    max: 10,
    maxPerIp: 1,
    pressure: { softLimitPercent: 80, authGracePeriod: 30 },
  });
  const metrics = createInMemoryMetrics();
  let onConnectCount = 0;
  let onDisconnectCount = 0;
  const handler = await buildRequestHandler(config, buildInfraContext({ metrics }), createPluginRegistry(), {
    connectionManager,
    onConnect: () => {
      onConnectCount++;
    },
    onDisconnect: () => {
      onDisconnectCount++;
    },
  });
  const req = new Request('http://localhost/', {
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
    },
  });
  const conn = { remoteAddr: { hostname: '127.0.0.1', port: 12345, transport: 'tcp' as const } };

  const response = handler(req, conn as any);

  assertEquals(response.status, 400);
  assertEquals(connections.size, 0);
  assertEquals(connectionManager.canAccept('127.0.0.1').allowed, true);
  assertEquals(onConnectCount, 0);
  assertEquals(onDisconnectCount, 0);
  assertEquals(metrics.getCounter('pfortner_connections_total'), 0);
});
