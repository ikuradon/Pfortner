import type { AdminState } from '$admin/server.ts';
import { json } from './json.ts';
import { getCredentialFromRequest, isSameOriginRequest, needsCookieCsrfCheck, redirectToLogin } from '../security.ts';

type FreshMiddlewareContext = {
  req: Request;
  next(): Promise<Response>;
};

export function createAdminAuthMiddleware(
  state: AdminState,
  adminPath: string,
): (ctx: FreshMiddlewareContext) => Promise<Response> {
  return async (ctx) => {
    const url = new URL(ctx.req.url);
    const path = url.pathname;

    if (path === `${adminPath}/login`) {
      return await ctx.next();
    }

    const credential = getCredentialFromRequest(ctx.req);
    if (!credential || credential.token !== state.config.admin?.auth_token) {
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
  };
}
