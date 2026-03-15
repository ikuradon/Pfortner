import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { buildRequestHandler } from './starter.ts';
import { loadConfigFromString } from './loader.ts';
import { buildInfraContext } from '../infra/context.ts';
import { createPluginRegistry } from '../plugins/registry.ts';

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
