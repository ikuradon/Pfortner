import { assertEquals, assertStringIncludes } from '@std/assert';

const oldServeEntrypoint = ['scripts', 'serve.ts'].join('/');

Deno.test('serve task grants runtime permissions for dataDir mode', async () => {
  const denoJson = JSON.parse(await Deno.readTextFile('deno.json')) as {
    tasks: Record<string, string>;
  };
  const serveTask = denoJson.tasks.serve;

  assertStringIncludes(serveTask, '--unstable-net');
  assertStringIncludes(serveTask, '--allow-write');
  assertStringIncludes(serveTask, '--allow-read');
  assertStringIncludes(serveTask, '--allow-net');
  assertStringIncludes(serveTask, '--allow-env');
  assertStringIncludes(serveTask, 'src/server/main.ts');
  assertEquals(serveTask.includes(oldServeEntrypoint), false);
});
