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
  createLogStreamResponse,
  getConnections,
  getHealthDetail,
  getHealthSimple,
  getLogs,
  getThroughputData,
  maskSecrets,
  parseLogLimit,
  simulatePipeline,
} from '$admin/service.ts';

import { LoginPage } from './routes/login.tsx';
import { AdminAppShell } from './routes/app.tsx';

const COOKIE_NAME = 'pfortner_admin_token';
const STATIC_DIR = new URL('./static', import.meta.url).pathname;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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

function renderAdminShell(pathname: string): Response {
  return renderHtml(h(AdminAppShell, { currentPath: pathname }));
}

function getCredentialFromRequest(req: Request): { token: string; source: 'bearer' | 'cookie' } | undefined {
  // Check Bearer token header
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return { token: auth.slice(7), source: 'bearer' };
  // Check cookie
  const cookie = req.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === COOKIE_NAME) return { token: decodeURIComponent(v ?? ''), source: 'cookie' };
  }
  return undefined;
}

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(',', 1)[0]?.trim() || undefined;
}

function getForwardedValue(req: Request, key: string): string | undefined {
  const forwarded = firstHeaderValue(req.headers.get('Forwarded'));
  if (!forwarded) return undefined;

  for (const part of forwarded.split(';')) {
    const [rawName, rawValue] = part.trim().split('=', 2);
    if (rawName?.toLowerCase() !== key) continue;
    return rawValue?.replace(/^"|"$/g, '');
  }
  return undefined;
}

function buildOrigin(protocol: string | undefined, host: string | undefined): string | undefined {
  const normalizedProtocol = protocol?.replace(/:$/, '').toLowerCase();
  const normalizedHost = host?.trim();
  if (!normalizedProtocol || !normalizedHost) return undefined;
  if (normalizedProtocol !== 'http' && normalizedProtocol !== 'https') return undefined;
  try {
    return new URL(`${normalizedProtocol}://${normalizedHost}`).origin;
  } catch {
    return undefined;
  }
}

function getAllowedRequestOrigins(req: Request, trustProxy: boolean): Set<string> {
  const url = new URL(req.url);
  const origins = new Set([url.origin]);
  if (!trustProxy) return origins;

  // Trust forwarded origin headers only when the deployment strips client-supplied values at the edge.
  const forwardedProto = firstHeaderValue(req.headers.get('X-Forwarded-Proto')) ??
    getForwardedValue(req, 'proto');
  const forwardedHost = firstHeaderValue(req.headers.get('X-Forwarded-Host')) ??
    getForwardedValue(req, 'host') ??
    req.headers.get('Host') ??
    url.host;
  const forwardedOrigin = buildOrigin(forwardedProto, forwardedHost);
  if (forwardedOrigin) origins.add(forwardedOrigin);
  return origins;
}

function isSameOriginRequest(req: Request, trustProxy: boolean): boolean {
  const allowedOrigins = getAllowedRequestOrigins(req, trustProxy);
  const origin = req.headers.get('Origin');
  if (origin !== null) return allowedOrigins.has(origin);

  const referer = req.headers.get('Referer');
  if (referer !== null) {
    try {
      return allowedOrigins.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  const fetchSite = req.headers.get('Sec-Fetch-Site');
  return fetchSite === 'same-origin';
}

function redirectToLogin(req: Request): Response {
  const url = new URL(req.url);
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/login?next=${next}` },
  });
}

const staticFileCache = new Map<string, { data: Uint8Array<ArrayBuffer>; contentType: string }>();

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

    const credential = getCredentialFromRequest(ctx.req);
    if (!credential || credential.token !== state.config.admin?.auth_token) {
      // For API routes, return 401 JSON
      if (path.startsWith(`${adminPath}/api/`)) {
        return json({ error: 'unauthorized' }, 401);
      }
      return redirectToLogin(ctx.req);
    }

    if (
      credential.source === 'cookie' &&
      !SAFE_METHODS.has(ctx.req.method) &&
      !isSameOriginRequest(ctx.req, state.config.admin?.trust_proxy === true)
    ) {
      return path.startsWith(`${adminPath}/api/`)
        ? json({ error: 'csrf validation failed' }, 403)
        : new Response('Forbidden', { status: 403 });
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
    if (typeof token === 'string' && token === state.config.admin?.auth_token) {
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
  app.get(adminPath, (_ctx) => {
    return new Response(null, {
      status: 302,
      headers: { Location: `${adminPath}/` },
    });
  });

  app.get(`${adminPath}/`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
  });

  app.get(`${adminPath}/connections`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
  });

  app.get(`${adminPath}/pipelines`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
  });

  app.get(`${adminPath}/playground`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
  });

  app.get(`${adminPath}/metrics`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
  });

  app.get(`${adminPath}/blacklist`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
  });

  app.get(`${adminPath}/config`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
  });

  app.get(`${adminPath}/logs`, (ctx) => {
    const url = new URL(ctx.req.url);
    return renderAdminShell(url.pathname);
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

  app.get(`${adminPath}/api/logs`, (ctx) => {
    const url = new URL(ctx.req.url);
    return json(getLogs(state, parseLogLimit(url.searchParams.get('limit'))));
  });

  app.get(`${adminPath}/api/logs/stream`, (ctx) => {
    const url = new URL(ctx.req.url);
    return createLogStreamResponse(state, {
      signal: ctx.req.signal,
      replay: parseLogLimit(url.searchParams.get('replay'), 100),
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
