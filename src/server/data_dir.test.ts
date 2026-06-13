import { assertEquals } from '@std/assert';
import { ensureDataDirLayout, resolveDataDirLayout } from './data_dir.ts';

Deno.test('resolveDataDirLayout derives all durable paths', () => {
  const layout = resolveDataDirLayout('/data');
  assertEquals(layout.root, '/data');
  assertEquals(layout.configPath, '/data/config.yaml');
  assertEquals(layout.adminTokenPath, '/data/admin-token');
  assertEquals(layout.pipelineDraftPath, '/data/pipeline-workbench.draft.json');
  assertEquals(layout.kvPath, '/data/kv/pfortner.sqlite3');
  assertEquals(layout.pluginsDir, '/data/plugins');
  assertEquals(layout.geoipDir, '/data/geoip');
});

Deno.test('ensureDataDirLayout creates directories but not config.yaml', async () => {
  const root = await Deno.makeTempDir();
  const layout = await ensureDataDirLayout(root);
  assertEquals(await exists(layout.pluginsDir), true);
  assertEquals(await exists(layout.geoipDir), true);
  assertEquals(await exists(layout.configPath), false);
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
