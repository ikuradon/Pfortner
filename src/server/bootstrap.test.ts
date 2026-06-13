import { assertEquals, assertRejects } from '@std/assert';
import { parse as parseYaml } from '@std/yaml';
import { buildSetupConfigYaml, detectBootstrapState, saveSetupConfig } from './bootstrap.ts';
import { ensureDataDirLayout } from './data_dir.ts';

Deno.test('detectBootstrapState enters setup mode without creating config.yaml', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  const state = await detectBootstrapState(layout);
  assertEquals(state.mode, 'setup');
  await assertRejects(() => Deno.stat(layout.configPath), Deno.errors.NotFound);
});

Deno.test('buildSetupConfigYaml includes default accept pipelines', () => {
  const yaml = buildSetupConfigYaml({
    upstreamRelay: 'wss://relay.example.com',
    relayName: 'Pfortner Relay',
    relayDescription: '',
  });
  const parsed = parseYaml(yaml) as any;
  assertEquals(parsed.server.upstream_relay, 'wss://relay.example.com');
  assertEquals(parsed.pipelines.client, [{ policy: 'accept' }]);
  assertEquals(parsed.pipelines.server, [{ policy: 'accept' }]);
});

Deno.test('buildSetupConfigYaml omits env-owned fields', () => {
  const yaml = buildSetupConfigYaml({
    upstreamRelay: 'wss://relay.example.com',
    relayName: 'Pfortner Relay',
    relayDescription: '',
  });
  const parsed = parseYaml(yaml) as any;
  assertEquals(parsed.server.port, undefined);
  assertEquals('admin' in parsed, false);
  assertEquals(parsed.infra?.kv?.path, undefined);
  assertEquals(parsed.infra?.metrics?.logging, undefined);
});

Deno.test('detectBootstrapState rejects non-file config path', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  await Deno.mkdir(layout.configPath);
  await assertRejects(
    () => detectBootstrapState(layout),
    Error,
    'exists but is not a file',
  );
});

Deno.test('saveSetupConfig writes config atomically after validation', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  await saveSetupConfig(layout, {
    upstreamRelay: 'wss://relay.example.com',
    relayName: 'Pfortner Relay',
    relayDescription: '',
  }, { backend: { kvAvailable: true, redisAvailable: false } });
  const written = await Deno.readTextFile(layout.configPath);
  const parsed = parseYaml(written) as any;
  assertEquals(parsed.pipelines.client[0].policy, 'accept');
});

Deno.test('saveSetupConfig rejects existing config.yaml without overwriting it', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  const original = 'server:\n  upstream_relay: "wss://original.example.com"\n';
  await Deno.writeTextFile(layout.configPath, original);
  await assertRejects(() =>
    saveSetupConfig(layout, {
      upstreamRelay: 'wss://relay.example.com',
      relayName: 'Pfortner Relay',
      relayDescription: '',
    }, { backend: { kvAvailable: true, redisAvailable: false } })
  );
  assertEquals(await Deno.readTextFile(layout.configPath), original);
});

Deno.test('saveSetupConfig rejects invalid upstream relay without creating config.yaml', async () => {
  for (const upstreamRelay of ['not-a-url', 'https://relay.example.com']) {
    const root = await Deno.makeTempDir();
    const layout = await ensureDataDirLayout(root);
    await assertRejects(() =>
      saveSetupConfig(layout, {
        upstreamRelay,
        relayName: 'Pfortner Relay',
        relayDescription: '',
      }, { backend: { kvAvailable: true, redisAvailable: false } })
    );
    await assertRejects(() => Deno.stat(layout.configPath), Deno.errors.NotFound);
  }
});

Deno.test('saveSetupConfig does not create config.yaml when validation fails', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  await assertRejects(() =>
    saveSetupConfig(layout, {
      upstreamRelay: '',
      relayName: 'Pfortner Relay',
      relayDescription: '',
    }, { backend: { kvAvailable: true, redisAvailable: false } })
  );
  await assertRejects(() => Deno.stat(layout.configPath), Deno.errors.NotFound);
});

Deno.test('saveSetupConfig removes temp file when atomic publish fails', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  await Deno.mkdir(layout.configPath);
  await assertRejects(() =>
    saveSetupConfig(layout, {
      upstreamRelay: 'wss://relay.example.com',
      relayName: 'Pfortner Relay',
      relayDescription: '',
    }, { backend: { kvAvailable: true, redisAvailable: false } })
  );
  const entries: string[] = [];
  for await (const entry of Deno.readDir(layout.root)) entries.push(entry.name);
  assertEquals(entries.some((name) => name.endsWith('.tmp')), false);
});
