import { assertEquals } from '@std/assert';
import { createUpstreamHeaders } from './upstream.ts';

Deno.test('upstream helper forwards client IP only when available', () => {
  assertEquals(createUpstreamHeaders('203.0.113.10'), {
    'X-Forwarded-For': '203.0.113.10',
  });
  assertEquals(createUpstreamHeaders(''), {});
  assertEquals(createUpstreamHeaders(undefined), {});
});
