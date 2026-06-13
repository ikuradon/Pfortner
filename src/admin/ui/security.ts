export const ADMIN_COOKIE_NAME = 'pfortner_admin_token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type AdminCredential = { token: string; source: 'bearer' | 'cookie' };

export function getCredentialFromRequest(req: Request): AdminCredential | undefined {
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return { token: auth.slice(7), source: 'bearer' };

  const cookie = req.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === ADMIN_COOKIE_NAME) return { token: decodeURIComponent(v ?? ''), source: 'cookie' };
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

export function getAllowedRequestOrigins(req: Request, trustProxy: boolean): Set<string> {
  const url = new URL(req.url);
  const origins = new Set([url.origin]);
  if (!trustProxy) return origins;

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

export function isSameOriginRequest(req: Request, trustProxy: boolean): boolean {
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

export function needsCookieCsrfCheck(req: Request, credential: AdminCredential): boolean {
  return credential.source === 'cookie' && !SAFE_METHODS.has(req.method);
}

export function redirectToLogin(req: Request, adminPath: string): Response {
  const url = new URL(req.url);
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, {
    status: 302,
    headers: { Location: `${adminPath}/login?next=${next}` },
  });
}

export function getSafeLoginNext(next: string | null | undefined, adminPath: string): string {
  if (typeof next === 'string' && (next.startsWith(adminPath + '/') || next === adminPath)) return next;
  return `${adminPath}/`;
}

export function buildAdminCookie(token: string, adminPath: string): string {
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${adminPath}`;
}

export function clearAdminCookie(adminPath: string): string {
  return `${ADMIN_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=${adminPath}; Max-Age=0`;
}
