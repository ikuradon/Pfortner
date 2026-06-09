/**
 * Admin UI — Fresh 2.x app factory.
 * Creates a request handler for the /admin/* sub-path.
 */
import { App } from '@fresh/core';
import { render } from 'preact-render-to-string';
import { h } from 'preact';
import { json } from '$admin/server.ts';
import type { AdminState } from '$admin/server.ts';

import { LoginPage } from './routes/login.tsx';
import { AdminAppShell } from './routes/app.tsx';
import { registerAdminApiRoutes } from './api_routes.ts';
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

function renderHtml(component: h.JSX.Element): Response {
  const html = '<!DOCTYPE html>' + render(component);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function renderAdminShell(pathname: string): Response {
  return renderHtml(h(AdminAppShell, { currentPath: pathname }));
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
      return await staticFiles.serve(relativePath);
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
  app.get(`${adminPath}/login`, (_ctx) => {
    return renderHtml(h(LoginPage as any, {}));
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
    return renderHtml(h(LoginPage, { error: 'Invalid token' }));
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

  registerAdminPageRoutes(app, adminPath, renderAdminShell);
  registerAdminApiRoutes(app, adminPath, state);

  return app.handler();
}
