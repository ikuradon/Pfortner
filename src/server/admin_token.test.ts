import { assertEquals, assertMatch } from '@std/assert';
import { resolveAdminAuth } from './admin_token.ts';

Deno.test('resolveAdminAuth returns disabled variant without reading token file', async () => {
  const auth = await resolveAdminAuth({
    enabled: false,
    tokenFile: '/path/that/does/not/exist',
  });
  assertEquals(auth, { enabled: false, path: '/admin' });
});

Deno.test('resolveAdminAuth uses PFORTNER_ADMIN_TOKEN before token file', async () => {
  const file = await Deno.makeTempFile();
  await Deno.writeTextFile(file, 'from-file');
  const auth = await resolveAdminAuth({
    enabled: true,
    token: 'from-env',
    tokenFile: file,
  });
  assertEquals(auth.enabled, true);
  if (auth.enabled) {
    assertEquals(auth.token, 'from-env');
    assertEquals(auth.tokenSource, 'env');
  }
});

Deno.test('resolveAdminAuth reuses existing token file', async () => {
  const file = await Deno.makeTempFile();
  await Deno.writeTextFile(file, 'existing-token\n');
  const auth = await resolveAdminAuth({ enabled: true, tokenFile: file });
  assertEquals(auth.enabled, true);
  if (auth.enabled) {
    assertEquals(auth.token, 'existing-token');
    assertEquals(auth.tokenSource, 'file');
  }
  assertEquals(await Deno.readTextFile(file), 'existing-token\n');
});

Deno.test('resolveAdminAuth generates a token when file is missing', async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/admin-token`;
  const auth = await resolveAdminAuth({ enabled: true, tokenFile: file });
  assertEquals(auth.enabled, true);
  if (auth.enabled) {
    assertEquals(auth.tokenSource, 'generated');
    assertMatch(auth.token, /^[A-Za-z0-9_-]{43,}$/);
    assertEquals(await Deno.readTextFile(file), auth.token);
    assertEquals((await Deno.stat(file)).mode! & 0o777, 0o600);
  }
});

Deno.test('resolveAdminAuth rereads token file when generation loses create race', async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/admin-token`;
  const originalWriteTextFile = Deno.writeTextFile;
  let intercepted = false;

  try {
    Deno.writeTextFile = async (...args: Parameters<typeof Deno.writeTextFile>) => {
      const [path] = args;
      if (path === file && !intercepted) {
        intercepted = true;
        await originalWriteTextFile(file, 'from-race', { createNew: true, mode: 0o600 });
        throw new Deno.errors.AlreadyExists('race');
      }
      return await originalWriteTextFile(...args);
    };

    const auth = await resolveAdminAuth({ enabled: true, tokenFile: file });
    assertEquals(intercepted, true);
    assertEquals(auth.enabled, true);
    if (auth.enabled) {
      assertEquals(auth.token, 'from-race');
      assertEquals(auth.tokenSource, 'file');
    }
  } finally {
    Deno.writeTextFile = originalWriteTextFile;
  }
});
