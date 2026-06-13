import { h } from 'preact';
import type { AdminState } from '$admin/server.ts';
import type { AdminRouteApp } from '../route_types.ts';
import { LoginPage } from '../routes/login.tsx';
import { buildAdminCookie, clearAdminCookie, getSafeLoginNext } from '../security.ts';

export function registerAdminLoginRoutes(
  app: AdminRouteApp,
  adminPath: string,
  state: AdminState,
): void {
  app.get(`${adminPath}/login`, (ctx) => {
    if (!state.adminAuth.enabled) {
      return ctx.render(h(LoginPage as any, { error: 'Admin is disabled' }));
    }
    return ctx.render(h(LoginPage as any, {}));
  });

  app.post(`${adminPath}/login`, async (ctx) => {
    const form = await ctx.req.formData();
    const token = form.get('token');
    if (!state.adminAuth.enabled) {
      return ctx.render(h(LoginPage as any, { error: 'Admin is disabled' }));
    }
    if (typeof token === 'string' && token === state.adminAuth.token) {
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

  app.get(`${adminPath}/logout`, (_ctx) => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${adminPath}/login`,
        'Set-Cookie': clearAdminCookie(adminPath),
      },
    });
  });
}
