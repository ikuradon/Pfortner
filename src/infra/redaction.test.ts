import { assertEquals } from '@std/assert';
import { redactUrlCredentials } from './redaction.ts';

Deno.test('redactUrlCredentials removes username and password from Redis URLs', () => {
  assertEquals(
    redactUrlCredentials('redis://user:SuperSecretPassword@redis.internal:6379/0'),
    'redis://redis.internal:6379/0',
  );
  assertEquals(
    redactUrlCredentials('rediss://:SuperSecretPassword@redis.internal:6379'),
    'rediss://redis.internal:6379',
  );
});

Deno.test('redactUrlCredentials leaves non-credential URL details intact', () => {
  assertEquals(redactUrlCredentials('redis://redis.internal:6379/0'), 'redis://redis.internal:6379/0');
});

Deno.test('redactUrlCredentials fails closed for unparseable URLs', () => {
  assertEquals(redactUrlCredentials('not-a-url'), '[redacted: unparseable URL]');
});
