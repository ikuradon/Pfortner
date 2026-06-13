import { assertEquals } from '@std/assert';

const ROOT_ADMIN_DIR = projectFile('admin/');
const GENERATED_ADMIN_STATIC_DIR = projectFile('src/admin/ui/static/');
const ROOT_ADMIN_DOCKER_COPY_REFERENCE = 'COPY ' + 'admin';
const PRODUCTION_DIRECTORIES = [
  projectFile('src/'),
  projectFile('scripts/'),
];
const PRODUCTION_FILES = [
  projectFile('mod.ts'),
  projectFile('deno.json'),
  projectFile('Dockerfile'),
];
const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|json)$/;
const RELATIVE_STRING_PATTERN = /(["'])(\.{1,2}\/[^"']*admin[^"']*)\1/g;
const DOCKER_ROOT_ADMIN_COPY_PATTERN = /^\s*COPY(?:\s+--\S+)*\s+admin(?:\s|$)/m;

Deno.test('production source does not import root admin implementation', async () => {
  const offenders: string[] = [];
  for (const file of await collectBoundarySourceFiles()) {
    const source = await Deno.readTextFile(file);
    const references = findRootAdminReferences(new URL(`file://${file}`), source);
    if (references.length > 0) {
      offenders.push(`${file}: ${references.join(', ')}`);
    }
  }

  assertEquals(offenders, []);
});

Deno.test('boundary scan covers production sources outside src/admin', async () => {
  const files = await collectBoundarySourceFiles();

  assertEquals(files.includes(projectFile('src/server/runtime.ts').pathname), true);
  assertEquals(files.includes(projectFile('scripts/build_admin_islands.ts').pathname), true);
  assertEquals(files.includes(projectFile('Dockerfile').pathname), true);
});

Deno.test('root admin detector rejects only project-root admin filesystem paths', () => {
  const serverFile = projectFile('src/server/runtime.ts');
  const scriptFile = projectFile('scripts/build_admin_islands.ts');
  const dockerfile = projectFile('Dockerfile');
  const srcAdminFromServer = '..' + '/admin/ui/main.ts';
  const rootAdminFromServer = '../..' + '/admin/main.ts';
  const rootAdminClientFromScript = '..' + '/admin/client/fresh_nav.js';

  assertEquals(
    findRootAdminReferences(
      serverFile,
      `import { createAdminApp } from '${srcAdminFromServer}';`,
    ),
    [],
  );
  assertEquals(
    findRootAdminReferences(
      serverFile,
      `const asset = '/admin/static/fresh_nav.js';`,
    ),
    [],
  );
  assertEquals(
    findRootAdminReferences(
      serverFile,
      `import { createAdminApp } from '${rootAdminFromServer}';`,
    ),
    [rootAdminFromServer],
  );
  assertEquals(
    findRootAdminReferences(
      scriptFile,
      `const entry = new URL('${rootAdminClientFromScript}', import.meta.url);`,
    ),
    [rootAdminClientFromScript],
  );
  assertEquals(
    findRootAdminReferences(
      dockerfile,
      `COPY --chown=deno ${'admin ./' + 'admin'}\n`,
    ),
    [ROOT_ADMIN_DOCKER_COPY_REFERENCE],
  );
});

Deno.test('root admin directory is not present', async () => {
  assertEquals(await exists(projectFile('admin/')), false);
});

function findRootAdminReferences(file: URL, source: string): string[] {
  if (file.pathname === projectFile('Dockerfile').pathname && DOCKER_ROOT_ADMIN_COPY_PATTERN.test(source)) {
    return [ROOT_ADMIN_DOCKER_COPY_REFERENCE];
  }

  const references: string[] = [];
  for (const match of source.matchAll(RELATIVE_STRING_PATTERN)) {
    const relativePath = match[2];
    if (resolvesInsideRootAdmin(file, relativePath)) {
      references.push(relativePath);
    }
  }
  return references;
}

function resolvesInsideRootAdmin(file: URL, relativePath: string): boolean {
  try {
    const resolved = new URL(relativePath, file);
    return resolved.pathname === ROOT_ADMIN_DIR.pathname.slice(0, -1) ||
      resolved.pathname.startsWith(ROOT_ADMIN_DIR.pathname);
  } catch {
    return false;
  }
}

async function collectBoundarySourceFiles(): Promise<string[]> {
  const files = [...PRODUCTION_FILES.map((file) => file.pathname)];
  for (const directory of PRODUCTION_DIRECTORIES) {
    files.push(...await collectSourceFiles(directory));
  }
  return files.sort();
}

function projectFile(path: string): URL {
  return new URL(`../../${path}`, import.meta.url);
}

async function collectSourceFiles(root: URL): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    const url = new URL(entry.name + (entry.isDirectory ? '/' : ''), root);
    if (entry.isDirectory) {
      if (url.pathname === GENERATED_ADMIN_STATIC_DIR.pathname) continue;
      files.push(...await collectSourceFiles(url));
    } else if (entry.isFile && SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(url.pathname);
    }
  }
  return files;
}

async function exists(path: URL): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
