import { assertEquals, assertThrows } from '@std/assert';
import { loadConfigFromString, loadProductionConfigFromString } from './loader.ts';
import type { ProductionPfortnerConfig } from './loader.ts';

Deno.test('loadConfigFromString parses minimal config', () => {
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
  assertEquals(config.server.port, 3000);
  assertEquals(config.server.upstream_relay, 'ws://localhost:7777');
  assertEquals(config.pipelines.client.length, 1);
});

Deno.test('loadConfigFromString parses full config', () => {
  const config = loadConfigFromString(`
server:
  port: 8080
  upstream_relay: "wss://relay.example.com"
  upstream_raw_url: "https://relay.example.com"
  idle_timeout: 300
  x_forwarded_for: true
auth:
  enabled: true
  send_on_connect: true
  max_attempts: 5
pipelines:
  client:
    - policy: write-guard
      config:
        require_auth: true
    - policy: accept
  server:
    - policy: kind-filter
      config:
        mode: deny
        kinds: [4]
    - policy: accept
`);
  assertEquals(config.server.port, 8080);
  assertEquals(config.auth?.enabled, true);
  assertEquals(config.pipelines.client.length, 2);
});

Deno.test('loadConfigFromString expands env vars', () => {
  Deno.env.set('TEST_RELAY', 'wss://test.example.com');
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "\${TEST_RELAY}"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
  assertEquals(config.server.upstream_relay, 'wss://test.example.com');
  Deno.env.delete('TEST_RELAY');
});

Deno.test('loadConfigFromString rejects missing upstream_relay', () => {
  try {
    loadConfigFromString(`
server:
  port: 3000
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('upstream_relay'), true);
  }
});

Deno.test('loadConfigFromString rejects missing pipelines', () => {
  try {
    loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
`);
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('pipelines'), true);
  }
});

Deno.test('loadConfigFromString rejects redis backend without infra.redis configured', () => {
  try {
    loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: rate-limit
      config:
        scope: ip
        window: 60
        backend: redis
  server:
    - policy: accept
`);
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('infra.redis'), true);
  }
});

Deno.test('loadConfigFromString rejects external plugins without a name', () => {
  try {
    loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
plugins:
  - path: "./plugins/example.ts"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('plugins[0].name'), true);
  }
});

Deno.test('loadConfigFromString rejects external plugins without exactly one source', () => {
  try {
    loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
plugins:
  - name: example
    path: "./plugins/example.ts"
    url: "file:///workspace/plugins/example.ts"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('plugins[0] requires exactly one'), true);
  }
});

Deno.test('loadConfigFromString rejects duplicate external plugin names', () => {
  try {
    loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
plugins:
  - name: example
    path: "./plugins/example.ts"
  - name: example
    path: "./plugins/other.ts"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('Duplicate external plugin name'), true);
  }
});

Deno.test('loadConfigFromString rejects external plugin names that duplicate builtins', () => {
  try {
    loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
plugins:
  - name: write-guard
    path: "./plugins/write-guard.ts"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('duplicates builtin plugin'), true);
  }
});

Deno.test('loadConfigFromString warns on admin.port', () => {
  // Just verify it doesn't error
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
admin:
  enabled: true
  port: 9091
  auth_token: "test"
  trust_proxy: true
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
  assertEquals(config.admin?.port, 9091);
  assertEquals(config.admin?.enabled, true);
  assertEquals(config.admin?.trust_proxy, true);
});

Deno.test('loadConfigFromString accepts redis backend when infra.redis is configured', () => {
  const config = loadConfigFromString(`
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
infra:
  redis:
    url: "redis://localhost:6379"
pipelines:
  client:
    - policy: rate-limit
      config:
        scope: ip
        window: 60
        backend: redis
  server:
    - policy: accept
`);
  assertEquals(config.infra?.redis?.url, 'redis://localhost:6379');
});

Deno.test('loadProductionConfigFromString rejects env-owned config keys', () => {
  assertThrows(
    () =>
      loadProductionConfigFromString(
        `
server:
  port: 3001
  upstream_relay: "ws://localhost:7777"
pipelines:
  client: []
  server: []
`,
        { backend: { kvAvailable: true, redisAvailable: false } },
      ),
    Error,
    'server.port is env-owned',
  );
});

Deno.test('loadProductionConfigFromString does not expand env placeholders', () => {
  const config = loadProductionConfigFromString(
    `
server:
  upstream_relay: "\${TEST_RELAY}"
pipelines:
  client: []
  server: []
`,
    { backend: { kvAvailable: true, redisAvailable: false } },
  );
  assertEquals(config.server.upstream_relay, '${TEST_RELAY}');
});

Deno.test('loadProductionConfigFromString does not default server.port', () => {
  const config: ProductionPfortnerConfig = loadProductionConfigFromString(
    `
server:
  upstream_relay: "ws://localhost:7777"
pipelines:
  client: []
  server: []
`,
    { backend: { kvAvailable: true, redisAvailable: false } },
  );
  assertEquals('port' in config.server, false);
});

Deno.test('loadProductionConfigFromString accepts kv backend when runtime kv is available', () => {
  const config = loadProductionConfigFromString(
    `
server:
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: rate-limit
      config:
        backend: kv
  server: []
`,
    { backend: { kvAvailable: true, redisAvailable: false } },
  );
  assertEquals(config.pipelines.client[0].policy, 'rate-limit');
});

Deno.test('loadProductionConfigFromString rejects kv backend without runtime kv', () => {
  assertThrows(
    () =>
      loadProductionConfigFromString(
        `
server:
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: rate-limit
      config:
        backend: kv
  server: []
`,
        { backend: { kvAvailable: false, redisAvailable: false } },
      ),
    Error,
    'requires KV backend',
  );
});

Deno.test('loadProductionConfigFromString rejects redis backend without runtime redis', () => {
  assertThrows(
    () =>
      loadProductionConfigFromString(
        `
server:
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: rate-limit
      config:
        backend: redis
  server: []
`,
        { backend: { kvAvailable: true, redisAvailable: false } },
      ),
    Error,
    'PFORTNER_REDIS_URL_FILE',
  );
});
