import { assertEquals } from '@std/assert';

const ADMIN_SOURCE_ROOT = new URL('./', import.meta.url);
const STATIC_IMPORT_PATTERNS = [
  '..' + '/static/',
  '../..' + '/static/',
  '.' + '/static/',
];
const STATIC_ISLAND_PREFIX = '..' + '/static/islands/';
const ALLOWED_STATIC_IMPORTS: Record<string, string[]> = {
  'src/admin/ui/client/fresh_nav.js': [
    `import('${STATIC_ISLAND_PREFIX}AdminIslandSmoke.js')`,
    `import('${STATIC_ISLAND_PREFIX}PipelineWorkbench.js')`,
  ],
};

function withoutAllowedStaticBridgeImports(
  adminPath: string,
  source: string,
): string {
  let normalized = source;
  for (const fragment of ALLOWED_STATIC_IMPORTS[adminPath] ?? []) {
    normalized = normalized.replaceAll(fragment, '');
  }
  return normalized;
}

async function collectSourceFiles(dir: URL): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const entryUrl = new URL(entry.name, dir);
    if (entry.isDirectory) {
      if (entry.name === 'static') continue;
      files.push(...await collectSourceFiles(new URL(`${entry.name}/`, dir)));
    } else if (entry.isFile && /\.(ts|tsx|js)$/.test(entry.name)) {
      files.push(entryUrl.pathname);
    }
  }
  return files;
}

Deno.test('admin source modules do not import implementation from admin/static', async () => {
  const files = await collectSourceFiles(ADMIN_SOURCE_ROOT);
  const offenders: string[] = [];

  for (const file of files) {
    const adminPath = file.replace(ADMIN_SOURCE_ROOT.pathname, 'src/admin/ui/');
    const source = withoutAllowedStaticBridgeImports(
      adminPath,
      await Deno.readTextFile(file),
    );
    if (STATIC_IMPORT_PATTERNS.some((pattern) => source.includes(pattern))) {
      offenders.push(adminPath);
    }
  }

  assertEquals(offenders, []);
});
