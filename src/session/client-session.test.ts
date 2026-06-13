import { assertEquals } from '@std/assert';
import { parseClientMessagePayload } from './client-session.ts';

Deno.test('client session parser accepts JSON array messages', () => {
  assertEquals(parseClientMessagePayload('["REQ","sub",{}]'), {
    ok: true,
    message: ['REQ', 'sub', {}],
  });
});

Deno.test('client session parser returns NOTICE errors for invalid payloads', () => {
  assertEquals(parseClientMessagePayload(42), {
    ok: false,
    notice: 'ERROR: bad msg: non-string message',
  });
  const result = parseClientMessagePayload('{');
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.notice, 'ERROR: bad msg: unparsable JSON');
    assertEquals(result.warning?.startsWith('Failed to parse client message:'), true);
  }
});
