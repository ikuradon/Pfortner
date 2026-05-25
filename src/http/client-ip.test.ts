import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { resolveClientIp } from './client-ip.ts';

const conn = { remoteAddr: { hostname: '127.0.0.1', port: 12345, transport: 'tcp' as const } };

Deno.test('resolveClientIp ignores X-Forwarded-For unless explicitly trusted', () => {
  const req = new Request('http://localhost/', {
    headers: { 'X-Forwarded-For': '203.0.113.123' },
  });

  assertEquals(resolveClientIp(req, conn as Deno.ServeHandlerInfo<Deno.NetAddr>, false), '127.0.0.1');
});

Deno.test('resolveClientIp uses X-Forwarded-For when explicitly trusted', () => {
  const req = new Request('http://localhost/', {
    headers: { 'X-Forwarded-For': '203.0.113.123' },
  });

  assertEquals(resolveClientIp(req, conn as Deno.ServeHandlerInfo<Deno.NetAddr>, true), '203.0.113.123');
});

Deno.test('resolveClientIp returns the first X-Forwarded-For address when explicitly trusted', () => {
  const req = new Request('http://localhost/', {
    headers: { 'X-Forwarded-For': '203.0.113.123, 10.0.0.1' },
  });

  assertEquals(resolveClientIp(req, conn as Deno.ServeHandlerInfo<Deno.NetAddr>, true), '203.0.113.123');
});
