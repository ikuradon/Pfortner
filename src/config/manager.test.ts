import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { ConfigManager } from './manager.ts';
import { buildInfraContext } from '../infra/context.ts';
import { createPluginRegistry } from '../plugins/registry.ts';

const YAML = `
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`;

Deno.test('ConfigManager initializes with generation 0', async () => {
  const manager = await ConfigManager.create(YAML, buildInfraContext({}), createPluginRegistry());
  assertEquals(manager.generation, 0);
  assertEquals(typeof manager.getRequestHandler(), 'function');
});

Deno.test('ConfigManager reload increments generation', async () => {
  const manager = await ConfigManager.create(YAML, buildInfraContext({}), createPluginRegistry());
  assertEquals(manager.generation, 0);
  await manager.reload(YAML);
  assertEquals(manager.generation, 1);
});

Deno.test('ConfigManager reload returns the parsed replacement config', async () => {
  const manager = await ConfigManager.create(YAML, buildInfraContext({}), createPluginRegistry());
  const reloaded = await manager.reload(`
server:
  port: 3001
  upstream_relay: "ws://localhost:8888"
admin:
  enabled: true
  auth_token: "rotated-token"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`);

  assertEquals(reloaded.admin?.auth_token, 'rotated-token');
  assertEquals(reloaded.server.port, 3001);
});

Deno.test('ConfigManager tracks active connections', async () => {
  const manager = await ConfigManager.create(YAML, buildInfraContext({}), createPluginRegistry());
  assertEquals(manager.activeConnections, 0);
  const release1 = manager.acquireConnection();
  assertEquals(manager.activeConnections, 1);
  const release2 = manager.acquireConnection();
  assertEquals(manager.activeConnections, 2);
  release1();
  assertEquals(manager.activeConnections, 1);
  release2();
  assertEquals(manager.activeConnections, 0);
});

Deno.test('ConfigManager destroy called on old generation when plugin removed', async () => {
  let destroyCalled = false;
  const registry = createPluginRegistry();
  registry.register({
    name: 'track-destroy',
    description: 'test',
    direction: 'both',
    configSchema: { type: 'object' },
    initialize() {
      return Promise.resolve((_i: any) => (m: any) => ({ message: m, action: 'next' as const }));
    },
    destroy() {
      destroyCalled = true;
      return Promise.resolve();
    },
  });

  const yamlWithPlugin = `
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: track-destroy
    - policy: accept
  server:
    - policy: accept
`;
  const yamlWithoutPlugin = `
server:
  port: 3000
  upstream_relay: "ws://localhost:7777"
pipelines:
  client:
    - policy: accept
  server:
    - policy: accept
`;
  const manager = await ConfigManager.create(yamlWithPlugin, buildInfraContext({}), registry);
  const release = manager.acquireConnection(); // gen 0 connection (uses track-destroy)
  await manager.reload(yamlWithoutPlugin); // gen 1 created (no track-destroy)
  assertEquals(destroyCalled, false); // gen 0 still has a connection
  release(); // gen 0 last connection released
  // Allow microtask for async destroy
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(destroyCalled, true); // track-destroy removed from gen 1, so destroy() called
});
