import { assertStringIncludes } from '@std/assert';

Deno.test('serve:config grants write access for admin pipeline saves', async () => {
  const denoJson = JSON.parse(await Deno.readTextFile('deno.json')) as {
    tasks: Record<string, string>;
  };

  assertStringIncludes(denoJson.tasks['serve:config'], '--allow-write');
});
