/**
 * Admin UI — Fresh 2.x app factory.
 * Creates a request handler for the /admin/* sub-path.
 */
import { App } from '@fresh/core';
import { h } from 'preact';
import { json } from '$admin/server.ts';
import type { AdminState } from '$admin/server.ts';
import { getHealthDetail } from '$admin/service.ts';

import { BlocklistPage } from './routes/blocklist.tsx';
import { ConfigPage } from './routes/config.tsx';
import { ConnectionsPage } from './routes/connections.tsx';
import { DashboardPage } from './routes/index.tsx';
import { LoginPage } from './routes/login.tsx';
import { LogsPage } from './routes/logs.tsx';
import { MetricsPage } from './routes/metrics.tsx';
import { PipelinesPage } from './routes/pipelines.tsx';
import { registerAdminApiRoutes } from './api_routes.ts';
import { installAdminIslandBuildCache } from './fresh_islands.ts';
import { registerAdminPageRoutes } from './page_routes.ts';
import {
  buildAdminCookie,
  clearAdminCookie,
  getCredentialFromRequest,
  getSafeLoginNext,
  isSameOriginRequest,
  needsCookieCsrfCheck,
  redirectToLogin,
} from './security.ts';
import { createStaticFileServer } from './static_files.ts';

const STATIC_DIR = new URL('./static', import.meta.url).pathname;
const staticFiles = createStaticFileServer(STATIC_DIR);
const EMPTY_FRESH_BOOT_IMPORT = 'import { boot } from ' + '"";';
const ADMIN_FRESH_NAV_SCRIPT = '/admin/static/fresh_nav.js';
const EMPTY_MODULE_PRELOAD_LINK = '<>; rel="modulepreload"; as="script"';
const ADMIN_FRESH_NAV_PRELOAD_LINK = `<${ADMIN_FRESH_NAV_SCRIPT}>; rel="modulepreload"; as="script"`;

type DashboardHealth = Parameters<typeof DashboardPage>[0]['health'];

function currentPath(req: Request): string {
  return new URL(req.url).pathname;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function buildDashboardHealth(state: AdminState): DashboardHealth {
  const detail = getHealthDetail(state);
  const connections = asRecord(detail.connections);
  const upstream = asRecord(detail.upstream);
  const memory = asRecord(detail.memory);

  return {
    status: stringOr(detail.status, 'ok'),
    connections: {
      active: numberOr(connections.active, state.connections.size),
      max: numberOr(connections.max, 0),
      pressure: stringOr(connections.pressure, 'normal'),
    },
    upstream: {
      status: stringOr(upstream.status, 'unknown'),
      latency_ms: nullableNumber(upstream.latency_ms),
    },
    uptime_seconds: nullableNumber(detail.uptime_seconds),
    memory: detail.memory === null ? null : {
      rss: numberOr(memory.rss, 0),
      heapUsed: numberOr(memory.heapUsed, 0),
    },
  };
}

async function withAdminFreshRuntime(response: Response): Promise<Response> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  if (!html.includes(EMPTY_FRESH_BOOT_IMPORT)) {
    return new Response(html, response);
  }

  const headers = new Headers(response.headers);
  const link = headers.get('Link');
  if (link?.includes(EMPTY_MODULE_PRELOAD_LINK)) {
    headers.set(
      'Link',
      link.replaceAll(EMPTY_MODULE_PRELOAD_LINK, ADMIN_FRESH_NAV_PRELOAD_LINK),
    );
  }

  return new Response(
    html.replaceAll(
      EMPTY_FRESH_BOOT_IMPORT,
      `import { boot } from "${ADMIN_FRESH_NAV_SCRIPT}";`,
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
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
  installAdminIslandBuildCache(app as App<unknown>);

  // ─── Static files middleware ───────────────────────────────────────────
  app.use(async (ctx) => {
    const url = new URL(ctx.req.url);
    const path = url.pathname;
    if (path.startsWith(`${adminPath}/static/`)) {
      const relativePath = path.slice(`${adminPath}/static`.length);
      return await staticFiles.serve(relativePath);
    }
    return await ctx.next();
  });

  app.use(async (ctx) => {
    return await withAdminFreshRuntime(await ctx.next());
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
      return redirectToLogin(ctx.req, adminPath);
    }

    if (
      needsCookieCsrfCheck(ctx.req, credential) &&
      !isSameOriginRequest(ctx.req, state.config.admin?.trust_proxy === true)
    ) {
      return path.startsWith(`${adminPath}/api/`)
        ? json({ error: 'csrf validation failed' }, 403)
        : new Response('Forbidden', { status: 403 });
    }

    return await ctx.next();
  });

  // ─── Login routes ──────────────────────────────────────────────────────
  app.get(`${adminPath}/login`, (ctx) => {
    return ctx.render(h(LoginPage as any, {}));
  });

  app.post(`${adminPath}/login`, async (ctx) => {
    const form = await ctx.req.formData();
    const token = form.get('token');
    if (typeof token === 'string' && token === state.config.admin?.auth_token) {
      const next = new URL(ctx.req.url).searchParams.get('next');
      const safeNext = getSafeLoginNext(next, adminPath);
      return new Response(null, {
        status: 302,
        headers: {
          Location: safeNext,
          'Set-Cookie': buildAdminCookie(token, adminPath),
        },
      });
    }
    return ctx.render(h(LoginPage as any, { error: 'Invalid token' }));
  });

  // Logout
  app.get(`${adminPath}/logout`, (_ctx) => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${adminPath}/login`,
        'Set-Cookie': clearAdminCookie(adminPath),
      },
    });
  });

  registerAdminPageRoutes(app, adminPath, {
    dashboard: (ctx) =>
      ctx.render(
        h(DashboardPage, {
          currentPath: currentPath(ctx.req),
          health: buildDashboardHealth(state),
        }),
      ),
    connections: (ctx) => ctx.render(h(ConnectionsPage, { currentPath: currentPath(ctx.req) })),
    pipelines: (ctx) =>
      ctx.render(
        h(PipelinesPage, {
          currentPath: currentPath(ctx.req),
          pipelines: state.config.pipelines,
          plugins: state.pluginNames,
        }),
      ),
    metrics: (ctx) => ctx.render(h(MetricsPage, { currentPath: currentPath(ctx.req) })),
    blocklist: (ctx) => ctx.render(h(BlocklistPage, { currentPath: currentPath(ctx.req) })),
    config: (ctx) => ctx.render(h(ConfigPage, { currentPath: currentPath(ctx.req) })),
    logs: (ctx) => ctx.render(h(LogsPage, { currentPath: currentPath(ctx.req) })),
  });
  registerAdminApiRoutes(app, adminPath, state);

  return app.handler();
}
