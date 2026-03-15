import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { loadConfigFromString } from './loader.ts';

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
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);
  assertEquals(config.admin?.port, 9091);
  assertEquals(config.admin?.enabled, true);
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
