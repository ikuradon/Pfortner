const EMPTY_FRESH_BOOT_IMPORT = 'import { boot } from ' + '"";';
const ADMIN_FRESH_NAV_SCRIPT = '/admin/static/fresh_nav.js';
const EMPTY_MODULE_PRELOAD_LINK = '<>; rel="modulepreload"; as="script"';
const ADMIN_FRESH_NAV_PRELOAD_LINK = `<${ADMIN_FRESH_NAV_SCRIPT}>; rel="modulepreload"; as="script"`;

export async function withAdminFreshRuntime(
  response: Response,
): Promise<Response> {
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
