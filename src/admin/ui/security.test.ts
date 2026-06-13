import { assertEquals } from '@std/assert';
import {
  buildAdminCookie,
  clearAdminCookie,
  getCredentialFromRequest,
  getSafeLoginNext,
  isSameOriginRequest,
} from './security.ts';

Deno.test('admin security reads bearer and cookie credentials', () => {
  const bearer = new Request('http://localhost/admin/api/health', {
    headers: { Authorization: 'Bearer token-1' },
  });
  const cookie = new Request('http://localhost/admin/api/health', {
    headers: { Cookie: 'other=x; pfortner_admin_token=token-2' },
  });

  assertEquals(getCredentialFromRequest(bearer), { token: 'token-1', source: 'bearer' });
  assertEquals(getCredentialFromRequest(cookie), { token: 'token-2', source: 'cookie' });
});

Deno.test('admin security validates same-origin browser requests', () => {
  const sameOrigin = new Request('https://admin.example/admin/api/shutdown', {
    method: 'POST',
    headers: { Origin: 'https://admin.example' },
  });
  const crossOrigin = new Request('https://admin.example/admin/api/shutdown', {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  });
  const forwarded = new Request('http://internal/admin/api/shutdown', {
    method: 'POST',
    headers: {
      Origin: 'https://admin.example',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'admin.example',
    },
  });

  assertEquals(isSameOriginRequest(sameOrigin, false), true);
  assertEquals(isSameOriginRequest(crossOrigin, false), false);
  assertEquals(isSameOriginRequest(forwarded, true), true);
  assertEquals(isSameOriginRequest(forwarded, false), false);
});

Deno.test('admin security constrains login redirect target', () => {
  assertEquals(getSafeLoginNext('/admin/logs', '/admin'), '/admin/logs');
  assertEquals(getSafeLoginNext('/admin', '/admin'), '/admin');
  assertEquals(getSafeLoginNext('https://evil.example', '/admin'), '/admin/');
  assertEquals(getSafeLoginNext('/other', '/admin'), '/admin/');
});

Deno.test('admin security creates scoped admin cookies', () => {
  assertEquals(
    buildAdminCookie('secret token', '/admin'),
    'pfortner_admin_token=secret%20token; HttpOnly; SameSite=Strict; Path=/admin',
  );
  assertEquals(
    clearAdminCookie('/admin'),
    'pfortner_admin_token=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0',
  );
});
