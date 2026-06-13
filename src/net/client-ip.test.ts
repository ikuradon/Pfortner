import { assertEquals } from '@std/assert';
import { selectClientIp } from './client-ip.ts';

function requestWithForwardedFor(value: string): Request {
  return new Request('http://localhost/', {
    headers: { 'X-Forwarded-For': value },
  });
}

Deno.test('selectClientIp ignores X-Forwarded-For unless explicitly trusted', () => {
  const result = selectClientIp(requestWithForwardedFor('127.0.0.1'), {
    remoteHostname: '203.0.113.77',
    trustForwardedFor: false,
  });

  assertEquals(result, '203.0.113.77');
});

Deno.test('selectClientIp uses X-Forwarded-For only when explicitly trusted', () => {
  const result = selectClientIp(requestWithForwardedFor('198.51.100.10, 10.0.0.5'), {
    remoteHostname: '10.0.0.5',
    trustForwardedFor: true,
  });

  assertEquals(result, '198.51.100.10');
});

Deno.test('selectClientIp falls back to remoteHostname when trusted but X-Forwarded-For is absent', () => {
  const result = selectClientIp(new Request('http://localhost/'), {
    remoteHostname: '203.0.113.77',
    trustForwardedFor: true,
  });

  assertEquals(result, '203.0.113.77');
});

Deno.test('selectClientIp returns empty string when no peer IP is available', () => {
  const result = selectClientIp(new Request('http://localhost/'), {
    remoteHostname: '',
    trustForwardedFor: false,
  });

  assertEquals(result, '');
});
