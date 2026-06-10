import { assertEquals } from '@std/assert';

const ISLANDS_ROOT = new URL('../', import.meta.url);

async function collectSourceFiles(dir: URL): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(entry.name, dir);
    if (entry.isDirectory) {
      files.push(...await collectSourceFiles(new URL(`${entry.name}/`, dir)));
      continue;
    }
    if (entry.isFile && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(child.pathname);
    }
  }
  return files;
}

Deno.test('admin islands do not import JavaScript implementations from static', async () => {
  const offenders: string[] = [];
  const staticOneUp = '../' + 'static/';
  const staticTwoUp = '../../' + 'static/';
  for (const path of await collectSourceFiles(ISLANDS_ROOT)) {
    const source = await Deno.readTextFile(path);
    if (source.includes(staticOneUp) || source.includes(staticTwoUp)) {
      offenders.push(path.replace(ISLANDS_ROOT.pathname, 'admin/islands/'));
    }
  }

  assertEquals(offenders, []);
});
