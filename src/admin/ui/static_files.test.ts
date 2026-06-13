import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createStaticFileServer } from './static_files.ts';

Deno.test('static file server serves known asset types with cache headers', async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/app.js`, 'console.log("ok");');
    await Deno.writeTextFile(`${dir}/style.css`, 'body{}');

    const server = createStaticFileServer(dir);
    const js = await server.serve('/app.js');
    const css = await server.serve('/style.css');

    assertEquals(js.status, 200);
    assertEquals(js.headers.get('Content-Type'), 'application/javascript; charset=utf-8');
    assertEquals(js.headers.get('Cache-Control'), 'no-cache');
    assertEquals(await js.text(), 'console.log("ok");');

    assertEquals(css.status, 200);
    assertEquals(css.headers.get('Content-Type'), 'text/css; charset=utf-8');
    assertEquals(css.headers.get('Cache-Control'), 'no-cache');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('static file server gives long cache to image assets', async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeFile(`${dir}/logo.svg`, new TextEncoder().encode('<svg></svg>'));

    const server = createStaticFileServer(dir);
    const res = await server.serve('/logo.svg');

    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Type'), 'image/svg+xml');
    assertEquals(res.headers.get('Cache-Control'), 'public, max-age=3600');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('static file server blocks traversal outside root', async () => {
  const root = await Deno.makeTempDir();
  const sibling = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${sibling}/secret.txt`, 'secret');

    const server = createStaticFileServer(root);
    const res = await server.serve(`../${sibling.split('/').pop()}/secret.txt`);

    assertEquals(res.status, 403);
    assertEquals(await res.text(), 'Forbidden');
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(sibling, { recursive: true });
  }
});

Deno.test('static file server returns not found for missing files', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const server = createStaticFileServer(dir);
    const res = await server.serve('/missing.js');

    assertEquals(res.status, 404);
    assertEquals(await res.text(), 'Not Found');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
