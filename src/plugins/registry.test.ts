import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createPluginRegistry } from './registry.ts';

Deno.test('registry loads external plugin from path', async () => {
  // Create a temp plugin file
  const tempDir = await Deno.makeTempDir();
  const pluginPath = `${tempDir}/test-plugin.ts`;
  await Deno.writeTextFile(
    pluginPath,
    `
    export default {
      name: 'test-external',
      description: 'Test external plugin',
      direction: 'both',
      configSchema: { type: 'object' },
      initialize(_config, _infra) { return Promise.resolve((_instance) => (message) => ({ message, action: 'next' })); },
    };
  `,
  );

  const registry = createPluginRegistry();
  await registry.loadExternal({ path: pluginPath });
  const plugin = registry.resolve('test-external');
  assertEquals(plugin.name, 'test-external');

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test('registry throws for invalid external plugin', async () => {
  const tempDir = await Deno.makeTempDir();
  const pluginPath = `${tempDir}/bad-plugin.ts`;
  await Deno.writeTextFile(pluginPath, 'export default { invalid: true };');

  const registry = createPluginRegistry();
  try {
    await registry.loadExternal({ path: pluginPath });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('name'), true);
  }

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test('registry resolves accept plugin', () => {
  assertEquals(createPluginRegistry().resolve('accept').name, 'accept');
});
Deno.test('registry resolves kind-filter', () => {
  assertEquals(createPluginRegistry().resolve('kind-filter').name, 'kind-filter');
});
Deno.test('registry resolves write-guard', () => {
  assertEquals(createPluginRegistry().resolve('write-guard').name, 'write-guard');
});
Deno.test('registry resolves protected-event', () => {
  assertEquals(createPluginRegistry().resolve('protected-event').name, 'protected-event');
});
Deno.test('registry throws for unknown plugin', () => {
  try {
    createPluginRegistry().resolve('nonexistent');
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('nonexistent'), true);
  }
});

Deno.test('registry resolves rate-limit', () => {
  assertEquals(createPluginRegistry().resolve('rate-limit').name, 'rate-limit');
});
Deno.test('registry resolves spam-filter', () => {
  assertEquals(createPluginRegistry().resolve('spam-filter').name, 'spam-filter');
});
Deno.test('registry resolves content-filter', () => {
  assertEquals(createPluginRegistry().resolve('content-filter').name, 'content-filter');
});
Deno.test('registry resolves pubkey-acl', () => {
  assertEquals(createPluginRegistry().resolve('pubkey-acl').name, 'pubkey-acl');
});
Deno.test('registry resolves ip-filter', () => {
  assertEquals(createPluginRegistry().resolve('ip-filter').name, 'ip-filter');
});
Deno.test('registry resolves when', () => {
  assertEquals(createPluginRegistry().resolve('when').name, 'when');
});
Deno.test('registry resolves match', () => {
  assertEquals(createPluginRegistry().resolve('match').name, 'match');
});
Deno.test('registry resolves route', () => {
  assertEquals(createPluginRegistry().resolve('route').name, 'route');
});

Deno.test('registry lists all 12 builtin plugins', () => {
  const names = createPluginRegistry().listNames();
  const expected = [
    'accept',
    'kind-filter',
    'write-guard',
    'protected-event',
    'rate-limit',
    'spam-filter',
    'content-filter',
    'pubkey-acl',
    'ip-filter',
    'when',
    'match',
    'route',
  ];
  assertEquals(names.length, 12);
  for (const name of expected) {
    assertEquals(names.includes(name), true);
  }
});
