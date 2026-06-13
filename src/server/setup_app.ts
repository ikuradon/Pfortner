import type { RuntimeBackendAvailability } from '../config/loader.ts';
import {
  buildAdminCookie,
  clearAdminCookie,
  getCredentialFromRequest,
  getSafeLoginNext,
  isSameOriginRequest,
  needsCookieCsrfCheck,
  redirectToLogin,
} from '../admin/ui/security.ts';
import { saveSetupConfig, SetupConfigValidationError } from './bootstrap.ts';
import type { DataDirLayout } from './data_dir.ts';
import type { AdminAuthState } from './types.ts';

export function createSetupHandler(options: {
  layout: DataDirLayout;
  runtime: { backend: RuntimeBackendAvailability };
  adminAuth: AdminAuthState;
  trustProxy: boolean;
}): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/admin/login') {
      return htmlResponse(renderLoginPage());
    }
    if (req.method === 'POST' && url.pathname === '/admin/login') {
      const form = await req.formData();
      const token = form.get('token');
      if (options.adminAuth.enabled && typeof token === 'string' && token === options.adminAuth.token) {
        const safeNext = getSafeLoginNext(url.searchParams.get('next'), '/admin');
        return new Response(null, {
          status: 302,
          headers: {
            Location: safeNext,
            'Set-Cookie': buildAdminCookie(token, '/admin'),
          },
        });
      }
      return htmlResponse(renderLoginPage('Invalid token'), { status: 401 });
    }
    if (req.method === 'GET' && url.pathname === '/admin/logout') {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/admin/login',
          'Set-Cookie': clearAdminCookie('/admin'),
        },
      });
    }
    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
      const authRes = authorizeSetupRequest(req, options.adminAuth, options.trustProxy);
      if (authRes) return authRes;
      return htmlResponse(renderSetupPage());
    }
    if (req.method === 'POST' && url.pathname === '/admin/setup') {
      const authRes = authorizeSetupRequest(req, options.adminAuth, options.trustProxy);
      if (authRes) return authRes;
      const form = await req.formData();
      const upstreamRelay = String(form.get('upstream_relay') ?? '').trim();
      if (!upstreamRelay) return htmlResponse(renderSetupPage('upstream_relay is required'), { status: 400 });
      try {
        await saveSetupConfig(options.layout, {
          upstreamRelay,
          relayName: String(form.get('relay_name') ?? 'Pfortner Relay'),
          relayDescription: String(form.get('relay_description') ?? ''),
        }, options.runtime);
      } catch (error) {
        if (error instanceof SetupConfigValidationError) {
          return htmlResponse(renderSetupPage(error.message), { status: 400 });
        }
        throw error;
      }
      return new Response(null, { status: 303, headers: { Location: '/admin/' } });
    }
    return new Response('Not Found', { status: 404 });
  };
}

function authorizeSetupRequest(req: Request, adminAuth: AdminAuthState, trustProxy: boolean): Response | undefined {
  if (!adminAuth.enabled) return new Response('Not Found', { status: 404 });

  const credential = getCredentialFromRequest(req);
  if (!credential || credential.token !== adminAuth.token) {
    if (req.method === 'GET' || req.method === 'HEAD') return redirectToLogin(req, '/admin');
    return new Response('Unauthorized', { status: 401 });
  }

  if (needsCookieCsrfCheck(req, credential) && !isSameOriginRequest(req, trustProxy)) {
    return new Response('Forbidden', { status: 403 });
  }

  return undefined;
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { ...init, headers });
}

function renderLoginPage(error = ''): string {
  return `<!doctype html>
<html><head><title>Pfortner Setup Login</title></head>
<body>
<main>
<h1>Pfortner Setup Login</h1>
${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/admin/login">
<label>Access token <input name="token" type="password" required autofocus></label>
<button type="submit">Sign In</button>
</form>
</main>
</body></html>`;
}

function renderSetupPage(error = ''): string {
  return `<!doctype html>
<html><head><title>Pfortner Setup</title></head>
<body>
<main>
<h1>Pfortner Setup</h1>
${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/admin/setup">
<label>Upstream relay <input name="upstream_relay" required></label>
<label>Relay name <input name="relay_name" value="Pfortner Relay"></label>
<label>Description <input name="relay_description"></label>
<button type="submit">Save</button>
</form>
</main>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
