import { assertEquals } from '@std/assert';

const serverEntrypoint = 'src/server/main.ts';
const oldServeEntrypoint = ['scripts', 'serve.ts'].join('/');
const removedServeTask = ['serve', 'config'].join(':');
const dataDirSetupCommand = 'RUN mkdir -p /data && chown deno:deno /data';

function projectFile(path: string): URL {
  return new URL(`../../${path}`, import.meta.url);
}

async function pathExists(path: URL): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function collectFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];

  for await (const entry of Deno.readDir(directory)) {
    const child = new URL(entry.name + (entry.isDirectory ? '/' : ''), directory);
    if (entry.isDirectory) {
      files.push(...await collectFiles(child));
    } else if (entry.isFile) {
      files.push(child);
    }
  }

  return files;
}

async function productionScopeFiles(): Promise<URL[]> {
  return [
    projectFile('deno.json'),
    projectFile('Dockerfile'),
    ...await collectFiles(projectFile('src/')),
    ...await collectFiles(projectFile('scripts/')),
  ];
}

function assertDockerfileOrder(dockerfile: string, earlier: string, later: string): void {
  const earlierIndex = dockerfile.indexOf(earlier);
  const laterIndex = dockerfile.indexOf(later);

  assertEquals(earlierIndex >= 0, true, `Dockerfile is missing ${earlier}`);
  assertEquals(laterIndex >= 0, true, `Dockerfile is missing ${later}`);
  assertEquals(earlierIndex < laterIndex, true, `${earlier} must appear before ${later}`);
}

Deno.test('serve and dev tasks use src/server/main.ts', async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(projectFile('deno.json')));

  assertEquals(String(denoJson.tasks.serve).includes(serverEntrypoint), true);
  assertEquals(String(denoJson.tasks.serve).includes(oldServeEntrypoint), false);
  assertEquals(removedServeTask in denoJson.tasks, false);
  assertEquals(String(denoJson.tasks.dev).includes(serverEntrypoint), true);
  assertEquals(String(denoJson.tasks.dev).includes(oldServeEntrypoint), false);
});

Deno.test('Dockerfile runs src/server/main.ts and checks /health', async () => {
  const dockerfile = await Deno.readTextFile(projectFile('Dockerfile'));

  assertEquals(dockerfile.includes('FROM denoland/deno:2.8.3'), true);
  assertEquals(dockerfile.includes('COPY --chown=deno deno.json deno.lock* ./'), true);
  assertEquals(dockerfile.includes('COPY --chown=deno mod.ts ./'), true);
  assertEquals(dockerfile.includes(`RUN deno cache ${serverEntrypoint} scripts/build_admin_islands.ts`), true);
  assertEquals(dockerfile.includes('RUN deno task build:admin-assets'), true);
  assertEquals(dockerfile.includes(dataDirSetupCommand), true);
  assertEquals(dockerfile.includes(serverEntrypoint), true);
  assertEquals(dockerfile.includes('http://localhost:3000/health'), true);
  assertEquals(dockerfile.includes('VOLUME ["/data"]') || dockerfile.includes('VOLUME /data'), true);
  assertEquals(dockerfile.includes('EXPOSE 3000'), true);
  assertEquals(dockerfile.includes('CMD ["task", "serve"]'), true);
  assertEquals(dockerfile.includes(oldServeEntrypoint), false);
  assertDockerfileOrder(dockerfile, dataDirSetupCommand, 'USER deno');
  assertDockerfileOrder(dockerfile, dataDirSetupCommand, 'VOLUME /data');
});

Deno.test('removed production wrapper has no production references', async () => {
  assertEquals(await pathExists(projectFile(oldServeEntrypoint)), false);

  for (const file of await productionScopeFiles()) {
    const content = await Deno.readTextFile(file);
    assertEquals(content.includes(oldServeEntrypoint), false, `${file.pathname} references removed entrypoint`);
    assertEquals(content.includes(removedServeTask), false, `${file.pathname} references removed task`);
  }
});
