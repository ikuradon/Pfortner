import { assertEquals } from '@std/assert';
import { toFileUrl } from '@std/path';
import { BUILTIN_PLUGIN_NAMES } from './builtin-names.ts';
import { createPluginRegistry } from './registry.ts';

Deno.test('registry loads external plugin from path', async () => {
  // Create a temp plugin file
  const tempDir = await Deno.makeTempDir({ dir: Deno.cwd() });
  const pluginPath = `${tempDir}/test-plugin.ts`;
  try {
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
    await registry.loadExternal({ name: 'test-external', path: pluginPath });
    const plugin = registry.resolve('test-external');
    assertEquals(plugin.name, 'test-external');
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('registry throws for invalid external plugin', async () => {
  const tempDir = await Deno.makeTempDir({ dir: Deno.cwd() });
  const pluginPath = `${tempDir}/bad-plugin.ts`;
  try {
    await Deno.writeTextFile(pluginPath, 'export default { invalid: true };');

    const registry = createPluginRegistry();
    try {
      await registry.loadExternal({ name: 'bad-plugin', path: pluginPath });
      throw new Error('should have thrown');
    } catch (e) {
      assertEquals((e as Error).message.includes('name'), true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('registry rejects non-file external plugin urls before import', async () => {
  const registry = createPluginRegistry();
  const source = `globalThis.__pfortnerRegistryRemoteImported = true; export default {
    name: 'remote-plugin',
    initialize() { return Promise.resolve((_instance) => (message) => ({ message, action: 'next' })); },
  };`;

  try {
    await registry.loadExternal({
      name: 'remote-plugin',
      url: `data:application/typescript,${encodeURIComponent(source)}`,
    });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('file:'), true);
  }

  assertEquals((globalThis as any).__pfortnerRegistryRemoteImported, undefined);
});

Deno.test('registry rejects empty external plugin urls', async () => {
  const registry = createPluginRegistry();
  try {
    await registry.loadExternal({ name: 'empty-plugin', url: '' });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message.includes('non-empty'), true);
  }
});

Deno.test('registry rejects external plugins outside the working directory', async () => {
  const tempDir = await Deno.makeTempDir();
  const pluginPath = `${tempDir}/outside-plugin.ts`;
  try {
    await Deno.writeTextFile(
      pluginPath,
      `
      export default {
        name: 'outside-plugin',
        description: 'Outside plugin',
        direction: 'both',
        configSchema: { type: 'object' },
        initialize(_config, _infra) { return Promise.resolve((_instance) => (message) => ({ message, action: 'next' })); },
      };
    `,
    );

    const registry = createPluginRegistry();
    try {
      await registry.loadExternal({ name: 'outside-plugin', path: pluginPath });
      throw new Error('should have thrown');
    } catch (e) {
      assertEquals((e as Error).message.includes('working directory'), true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('registry rejects file urls outside the working directory', async () => {
  const tempDir = await Deno.makeTempDir();
  const pluginPath = `${tempDir}/outside-url-plugin.ts`;
  try {
    await Deno.writeTextFile(
      pluginPath,
      `
      export default {
        name: 'outside-url-plugin',
        description: 'Outside URL plugin',
        direction: 'both',
        configSchema: { type: 'object' },
        initialize(_config, _infra) { return Promise.resolve((_instance) => (message) => ({ message, action: 'next' })); },
      };
    `,
    );

    const registry = createPluginRegistry();
    try {
      await registry.loadExternal({ name: 'outside-url-plugin', url: toFileUrl(pluginPath).href });
      throw new Error('should have thrown');
    } catch (e) {
      assertEquals((e as Error).message.includes('working directory'), true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('registry rejects external plugin names that duplicate builtins', async () => {
  const tempDir = await Deno.makeTempDir({ dir: Deno.cwd() });
  const pluginPath = `${tempDir}/write-guard-plugin.ts`;
  try {
    await Deno.writeTextFile(
      pluginPath,
      `
      export default {
        name: 'write-guard',
        description: 'Malicious replacement',
        direction: 'both',
        configSchema: { type: 'object' },
        initialize(_config, _infra) { return Promise.resolve((_instance) => (message) => ({ message, action: 'next' })); },
      };
    `,
    );

    const registry = createPluginRegistry();
    const before = registry.resolve('write-guard').description;
    try {
      await registry.loadExternal({ name: 'write-guard', path: pluginPath });
      throw new Error('should have thrown');
    } catch (e) {
      assertEquals((e as Error).message.includes('already registered'), true);
    }
    assertEquals(registry.resolve('write-guard').description, before);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('registry rejects duplicate declared external plugin names before import', async () => {
  const tempDir = await Deno.makeTempDir({ dir: Deno.cwd() });
  const pluginPath = `${tempDir}/write-guard-side-effect-plugin.ts`;
  try {
    await Deno.writeTextFile(
      pluginPath,
      `
      globalThis.__pfortnerRegistryDuplicateImported = true;
      export default {
        name: 'write-guard',
        description: 'Malicious replacement',
        direction: 'both',
        configSchema: { type: 'object' },
        initialize(_config, _infra) { return Promise.resolve((_instance) => (message) => ({ message, action: 'next' })); },
      };
    `,
    );

    const registry = createPluginRegistry();
    try {
      await registry.loadExternal({ name: 'write-guard', path: pluginPath });
      throw new Error('should have thrown');
    } catch (e) {
      assertEquals((e as Error).message.includes('already registered'), true);
    }
    assertEquals((globalThis as any).__pfortnerRegistryDuplicateImported, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('registry rejects external plugins whose exported name does not match the declared name', async () => {
  const tempDir = await Deno.makeTempDir({ dir: Deno.cwd() });
  const pluginPath = `${tempDir}/mismatched-plugin.ts`;
  try {
    await Deno.writeTextFile(
      pluginPath,
      `
      export default {
        name: 'actual-plugin',
        description: 'Mismatched plugin',
        direction: 'both',
        configSchema: { type: 'object' },
        initialize(_config, _infra) { return Promise.resolve((_instance) => (message) => ({ message, action: 'next' })); },
      };
    `,
    );

    const registry = createPluginRegistry();
    try {
      await registry.loadExternal({ name: 'declared-plugin', path: pluginPath });
      throw new Error('should have thrown');
    } catch (e) {
      assertEquals((e as Error).message.includes('does not match declared name'), true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
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
  assertEquals(names.length, BUILTIN_PLUGIN_NAMES.length);
  for (const name of BUILTIN_PLUGIN_NAMES) {
    assertEquals(names.includes(name), true);
  }
});
