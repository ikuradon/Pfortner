import { resolve } from '@std/path';

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  ico: 'image/x-icon',
  png: 'image/png',
  svg: 'image/svg+xml',
};

type CachedStaticFile = {
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
};

export type StaticFileServer = {
  serve(relativePath: string): Promise<Response>;
};

function getStaticCacheControl(ext: string): string {
  return ext === 'js' || ext === 'css' ? 'no-cache' : 'public, max-age=3600';
}

function isWithinRoot(filePath: string, rootDir: string): boolean {
  return filePath.startsWith(rootDir + '/') || filePath === rootDir;
}

async function serveStaticFile(
  filePath: string,
  cache: Map<string, CachedStaticFile>,
): Promise<Response> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const cacheControl = getStaticCacheControl(ext);
  const cached = cache.get(filePath);
  if (cached) {
    return new Response(cached.data, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': cacheControl,
      },
    });
  }

  try {
    const data = await Deno.readFile(filePath);
    cache.set(filePath, { data, contentType });
    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

export function createStaticFileServer(rootDir: string): StaticFileServer {
  const resolvedRootDir = resolve(rootDir);
  const cache = new Map<string, CachedStaticFile>();

  return {
    serve(relativePath: string): Promise<Response> {
      const resolvedPath = resolve(resolvedRootDir, relativePath.replace(/^\//, ''));
      if (!isWithinRoot(resolvedPath, resolvedRootDir)) {
        return Promise.resolve(new Response('Forbidden', { status: 403 }));
      }
      return serveStaticFile(resolvedPath, cache);
    },
  };
}
