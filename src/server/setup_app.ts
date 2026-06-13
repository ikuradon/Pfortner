import type { RuntimeBackendAvailability } from '../config/loader.ts';
import { saveSetupConfig, SetupConfigValidationError } from './bootstrap.ts';
import type { DataDirLayout } from './data_dir.ts';

export function createSetupHandler(options: {
  layout: DataDirLayout;
  runtime: { backend: RuntimeBackendAvailability };
}): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
      return htmlResponse(renderSetupPage());
    }
    if (req.method === 'POST' && url.pathname === '/admin/setup') {
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

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { ...init, headers });
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
