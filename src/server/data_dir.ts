import { join } from '@std/path';

export interface DataDirLayout {
  root: string;
  configPath: string;
  adminTokenPath: string;
  pipelineDraftPath: string;
  kvDir: string;
  kvPath: string;
  pluginsDir: string;
  geoipDir: string;
}

export function resolveDataDirLayout(root: string): DataDirLayout {
  return {
    root,
    configPath: join(root, 'config.yaml'),
    adminTokenPath: join(root, 'admin-token'),
    pipelineDraftPath: join(root, 'pipeline-workbench.draft.json'),
    kvDir: join(root, 'kv'),
    kvPath: join(root, 'kv', 'pfortner.sqlite3'),
    pluginsDir: join(root, 'plugins'),
    geoipDir: join(root, 'geoip'),
  };
}

export async function ensureDataDirLayout(root: string): Promise<DataDirLayout> {
  const layout = resolveDataDirLayout(root);
  await Deno.mkdir(layout.root, { recursive: true });
  await Deno.mkdir(layout.kvDir, { recursive: true });
  await Deno.mkdir(layout.pluginsDir, { recursive: true });
  await Deno.mkdir(layout.geoipDir, { recursive: true });
  await assertWritable(layout.root);
  return layout;
}

async function assertWritable(path: string): Promise<void> {
  const probe = join(path, `.pfortner-write-test-${crypto.randomUUID()}`);
  await Deno.writeTextFile(probe, '');
  await Deno.remove(probe);
}
