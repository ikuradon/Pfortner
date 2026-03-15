/**
 * Admin UI — Fresh 2.x app factory.
 * Creates a request handler for the /admin/* sub-path.
 */
import { App } from '@fresh/core';
import { render } from 'preact-render-to-string';
import { h } from 'preact';
import { resolve } from '@std/path';
import { json } from '$admin/server.ts';
import type { AdminState } from '$admin/server.ts';
import {
  closeConnectionBatch,
  getConnections,
  getHealthDetail,
  getHealthSimple,
  getThroughputData,
  maskSecrets,
  simulatePipeline,
} from '$admin/service.ts';

// Page components
import { LoginPage } from './routes/login.tsx';
import { DashboardPage } from './routes/index.tsx';
import { ConnectionsPage } from './routes/connections.tsx';
import { PipelinesPage } from './routes/pipelines.tsx';
import { PlaygroundPage } from './routes/playground.tsx';
import { MetricsPage } from './routes/metrics.tsx';
import { BlacklistPage } from './routes/blacklist.tsx';
import { ConfigPage } from './routes/config.tsx';
import { LogsPage } from './routes/logs.tsx';

const COOKIE_NAME = 'pfortner_admin_token';
const STATIC_DIR = new URL('./static', import.meta.url).pathname;

const RESOLVED_STATIC_DIR = resolve(STATIC_DIR);

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  ico: 'image/x-icon',
  png: 'image/png',
  svg: 'image/svg+xml',
};

function renderHtml(component: h.JSX.Element): Response {
  const html = '<!DOCTYPE html>' + render(component);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function getTokenFromRequest(req: Request): string | undefined {
  // Check Bearer token header
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  // Check cookie
  const cookie = req.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === COOKIE_NAME) return decodeURIComponent(v ?? '');
  }
  return undefined;
}

function redirectToLogin(req: Request): Response {
  const url = new URL(req.url);
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/login?next=${next}` },
  });
}

const staticFileCache = new Map<string, { data: Uint8Array; contentType: string }>();

async function serveStaticFile(filePath: string): Promise<Response> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const cached = staticFileCache.get(filePath);
  if (cached) {
    return new Response(cached.data, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  try {
    const data = await Deno.readFile(filePath);
    staticFileCache.set(filePath, { data, contentType });
    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

/**
 * Creates and returns a Fresh-based admin UI handler.
 * The handler processes all requests for /admin/* paths.
 */
export function createAdminApp(
  state: AdminState,
): (req: Request) => Promise<Response> {
  const authToken = state.config.admin?.auth_token;
  const adminPath = '/admin';

  const app = new App({ root: STATIC_DIR } as Record<string, unknown> as any);

  // ─── Static files middleware ───────────────────────────────────────────
  app.use(async (ctx) => {
    const url = new URL(ctx.req.url);
    const path = url.pathname;
    if (path.startsWith(`${adminPath}/static/`)) {
      const relativePath = path.slice(`${adminPath}/static`.length);
      // Prevent path traversal: resolve the full path and verify it stays within STATIC_DIR
      const resolvedPath = resolve(STATIC_DIR, relativePath.replace(/^\//, ''));
      if (!resolvedPath.startsWith(RESOLVED_STATIC_DIR + '/') && resolvedPath !== RESOLVED_STATIC_DIR) {
        return new Response('Forbidden', { status: 403 });
      }
      return await serveStaticFile(resolvedPath);
    }
    return await ctx.next();
  });

  // ─── Auth middleware ───────────────────────────────────────────────────
  app.use(async (ctx) => {
    const url = new URL(ctx.req.url);
    const path = url.pathname;

    // Skip auth for login page
    if (path === `${adminPath}/login`) {
      return await ctx.next();
    }

    const token = getTokenFromRequest(ctx.req);
    if (!token || token !== authToken) {
      // For API routes, return 401 JSON
      if (path.startsWith(`${adminPath}/api/`)) {
        return json({ error: 'unauthorized' }, 401);
      }
      return redirectToLogin(ctx.req);
    }

    return await ctx.next();
  });

  // ─── Login routes ──────────────────────────────────────────────────────
  app.get(`${adminPath}/login`, (_ctx) => {
    return renderHtml(h(LoginPage as any, {}));
  });

  app.post(`${adminPath}/login`, async (ctx) => {
    const form = await ctx.req.formData();
    const token = form.get('token');
    if (typeof token === 'string' && token === authToken) {
      const next = new URL(ctx.req.url).searchParams.get('next') ??
        `${adminPath}/`;
      const safeNext = (next.startsWith(adminPath + '/') || next === adminPath) ? next : `${adminPath}/`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: safeNext,
          'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${adminPath}`,
        },
      });
    }
    return renderHtml(h(LoginPage, { error: 'Invalid token' }));
  });

  // Logout
  app.get(`${adminPath}/logout`, (_ctx) => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${adminPath}/login`,
        'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=${adminPath}; Max-Age=0`,
      },
    });
  });

  // ─── Page routes ───────────────────────────────────────────────────────
  app.get(`${adminPath}/`, (ctx) => {
    const url = new URL(ctx.req.url);
    const detail = getHealthDetail(state);
    const conns = state.connectionManager?.getStats();
    const health = {
      status: String(detail.status),
      uptime_seconds: detail.uptime_seconds as number | null,
      connections: {
        active: (conns?.active ?? state.connections.size) as number,
        max: (conns?.max ?? 0) as number,
        pressure: String(conns?.pressure ?? 'normal'),
      },
      upstream: {
        status: String(
          (detail.upstream as { status?: string })?.status ?? 'unknown',
        ),
        latency_ms: (detail.upstream as { latency_ms?: number | null })?.latency_ms ??
          null,
      },
      memory: detail.memory as { rss: number; heapUsed: number } | null,
    };
    return renderHtml(h(DashboardPage, { currentPath: url.pathname, health }));
  });

  app.get(`${adminPath}/connections`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderHtml(h(ConnectionsPage, { currentPath: url.pathname }));
  });

  app.get(`${adminPath}/pipelines`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderHtml(h(PipelinesPage, { currentPath: url.pathname }));
  });

  app.get(`${adminPath}/playground`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderHtml(h(PlaygroundPage, { currentPath: url.pathname }));
  });

  app.get(`${adminPath}/metrics`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderHtml(h(MetricsPage, { currentPath: url.pathname }));
  });

  app.get(`${adminPath}/blacklist`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderHtml(h(BlacklistPage, { currentPath: url.pathname }));
  });

  app.get(`${adminPath}/config`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderHtml(h(ConfigPage, { currentPath: url.pathname }));
  });

  app.get(`${adminPath}/logs`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderHtml(h(LogsPage, { currentPath: url.pathname }));
  });

  // ─── API routes ────────────────────────────────────────────────────────
  app.get(`${adminPath}/api/health`, (_ctx) => {
    return json(getHealthSimple(state));
  });

  app.get(`${adminPath}/api/health/detail`, (_ctx) => {
    return json(getHealthDetail(state));
  });

  app.get(`${adminPath}/api/connections`, (_ctx) => {
    return json({ connections: getConnections(state) });
  });

  app.post(`${adminPath}/api/connections/disconnect-batch`, async (ctx) => {
    const body = await ctx.req.json();
    if (Array.isArray(body.ids)) {
      return json(closeConnectionBatch(state, body.ids));
    }
    return json({ error: 'ids array required' }, 400);
  });

  app.get(`${adminPath}/api/metrics/throughput`, (_ctx) => {
    return json(getThroughputData(state));
  });

  app.get(`${adminPath}/api/metrics/prometheus`, (_ctx) => {
    if (!state.metrics) {
      return new Response('# Prometheus metrics not enabled\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(state.metrics.render(), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });

  // ─── Config API ────────────────────────────────────────────────────────
  app.get(`${adminPath}/api/config`, (_ctx) => {
    return json(maskSecrets(state.config));
  });

  // ─── Plugins API ───────────────────────────────────────────────────────
  app.get(`${adminPath}/api/plugins`, (_ctx) => {
    return json({ plugins: state.pluginNames });
  });

  // ─── Playground API ────────────────────────────────────────────────────
  app.post(`${adminPath}/api/playground/evaluate`, async (ctx) => {
    try {
      const body = await ctx.req.json();
      const message = body.message;
      const direction = body.direction ?? 'client';
      const connectionInfo = {
        clientAuthorized: body.connectionInfo?.authenticated ?? false,
        clientPubkey: body.connectionInfo?.pubkey ?? '',
        connectionIpAddr: body.connectionInfo?.clientIp ?? '127.0.0.1',
      };
      if (!Array.isArray(message)) {
        return json({ error: 'message must be an array' }, 400);
      }
      const pipeline = direction === 'server'
        ? (state.config.pipelines?.server ?? [])
        : (state.config.pipelines?.client ?? []);
      const result = await simulatePipeline(pipeline, message, connectionInfo);
      return json(result);
    } catch (e) {
      return json({ error: `evaluation failed: ${(e as Error).message}` }, 500);
    }
  });

  // ─── Blacklist API ─────────────────────────────────────────────────────
  app.get(`${adminPath}/api/blacklist`, (_ctx) => {
    return json({
      pubkeys: [...state.blacklist.pubkeys],
      ips: [...state.blacklist.ips],
    });
  });

  app.post(`${adminPath}/api/blacklist/pubkey`, async (ctx) => {
    const body = await ctx.req.json();
    if (typeof body.pubkey === 'string' && body.pubkey.length > 0) {
      state.blacklist.pubkeys.add(body.pubkey);
      return json({ added: body.pubkey });
    }
    return json({ error: 'pubkey required' }, 400);
  });

  app.delete(`${adminPath}/api/blacklist/pubkey/:pk`, (ctx) => {
    const pk = (ctx.params as Record<string, string>).pk ?? '';
    if (pk) {
      state.blacklist.pubkeys.delete(pk);
      return json({ deleted: pk });
    }
    return json({ error: 'pubkey required' }, 400);
  });

  app.post(`${adminPath}/api/blacklist/ip`, async (ctx) => {
    const body = await ctx.req.json();
    if (typeof body.ip === 'string' && body.ip.length > 0) {
      state.blacklist.ips.add(body.ip);
      return json({ added: body.ip });
    }
    return json({ error: 'ip required' }, 400);
  });

  app.delete(`${adminPath}/api/blacklist/ip/:ip`, (ctx) => {
    const ip = (ctx.params as Record<string, string>).ip ?? '';
    if (ip) {
      state.blacklist.ips.delete(ip);
      return json({ deleted: ip });
    }
    return json({ error: 'ip required' }, 400);
  });

  app.post(`${adminPath}/api/reload`, async (_ctx) => {
    if (!state.configPath || !state.reloadFn) {
      return json({ error: 'reload not configured' }, 500);
    }
    try {
      const content = await Deno.readTextFile(state.configPath);
      await state.reloadFn(content);
      return new Response(null, {
        status: 302,
        headers: { Location: `${adminPath}/` },
      });
    } catch (e) {
      return json({ error: `reload failed: ${(e as Error).message}` }, 500);
    }
  });

  app.post(`${adminPath}/api/shutdown`, (_ctx) => {
    if (state.shutdownManager) {
      state.shutdownManager.initiateShutdown().catch(console.error);
      return new Response(null, {
        status: 302,
        headers: { Location: `${adminPath}/` },
      });
    }
    return json({ error: 'shutdown not configured' }, 500);
  });

  return app.handler();
}
