import { assertEquals } from '@std/assert';
import { BenchClient } from './client.ts';

Deno.test('BenchClient generateEvent creates valid structure', () => {
  const event = BenchClient.generateEvent(1, 50);
  assertEquals(event.kind, 1);
  assertEquals(typeof event.id, 'string');
  assertEquals(typeof event.pubkey, 'string');
  assertEquals(typeof event.content, 'string');
  assertEquals((event.content as string).length >= 50, true);
  assertEquals(typeof event.created_at, 'number');
  assertEquals(Array.isArray(event.tags), true);
  assertEquals(typeof event.sig, 'string');
});

Deno.test('BenchClient generateEvent respects kind and content length', () => {
  const event = BenchClient.generateEvent(30023, 200);
  assertEquals(event.kind, 30023);
  assertEquals((event.content as string).length >= 200, true);
});

Deno.test('BenchClient generateSubId returns unique IDs', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) ids.add(BenchClient.generateSubId());
  assertEquals(ids.size, 100);
});
