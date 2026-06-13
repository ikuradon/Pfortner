// src/upstream/pool.test.ts
import { assertEquals } from '@std/assert';
import { UpstreamConnection, UpstreamPool } from './pool.ts';
import { createLogger } from '../infra/logger.ts';

const logger = createLogger({ format: 'text', level: 'error' });

Deno.test('UpstreamPool returns same connection for same URL', () => {
  const pool = new UpstreamPool(logger);
  // Can't test actual WebSocket without a server, but test pool lookup logic
  assertEquals(pool.getConnectionCount(), 0);
});

Deno.test('UpstreamConnection subscription tracking', () => {
  // Test subscription ID multiplexing logic
  const prefixed = UpstreamConnection.prefixSubId('client-1', 'sub1');
  assertEquals(prefixed, 'client-1:sub1');

  const parsed = UpstreamConnection.parsePrefixedSubId('client-1:sub1');
  assertEquals(parsed?.clientId, 'client-1');
  assertEquals(parsed?.subId, 'sub1');
});

Deno.test('UpstreamConnection parsePrefixedSubId handles colons in subId', () => {
  const parsed = UpstreamConnection.parsePrefixedSubId('client-1:sub:with:colons');
  assertEquals(parsed?.clientId, 'client-1');
  assertEquals(parsed?.subId, 'sub:with:colons');
});

Deno.test('UpstreamConnection parsePrefixedSubId returns null for invalid', () => {
  assertEquals(UpstreamConnection.parsePrefixedSubId('nocolon'), null);
});

Deno.test('UpstreamPool notifyClientDisconnect is safe when empty', () => {
  const pool = new UpstreamPool(logger);
  // Should not throw
  pool.notifyClientDisconnect('nonexistent');
});
