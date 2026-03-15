import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createKvClient } from './kv.ts';

Deno.test('kv get/set', async () => {
  const client = await createKvClient({ path: ':memory:' });
  await client.set('key1', 'value1');
  assertEquals(await client.get('key1'), 'value1');
  await client.del('key1');
  assertEquals(await client.get('key1'), null);
  await client.close();
});

Deno.test('kv incr', async () => {
  const client = await createKvClient({ path: ':memory:' });
  assertEquals(await client.incr('counter'), 1);
  assertEquals(await client.incr('counter'), 2);
  await client.del('counter');
  await client.close();
});

Deno.test('kv sadd/sismember', async () => {
  const client = await createKvClient({ path: ':memory:' });
  await client.sadd('set1', 'a', 'b');
  assertEquals(await client.sismember('set1', 'a'), true);
  assertEquals(await client.sismember('set1', 'c'), false);
  await client.del('set1');
  await client.close();
});

Deno.test('kv set with TTL expires', async () => {
  const client = await createKvClient({ path: ':memory:' });
  await client.set('ttl-key', 'value', 1); // 1 second TTL
  assertEquals(await client.get('ttl-key'), 'value');
  await new Promise((r) => setTimeout(r, 1500)); // wait for expiry
  assertEquals(await client.get('ttl-key'), null);
  await client.close();
});

Deno.test('kv zadd/zcard/zremrangebyscore', async () => {
  const client = await createKvClient({ path: ':memory:' });
  await client.zadd('zset', 100, 'a');
  await client.zadd('zset', 200, 'b');
  await client.zadd('zset', 300, 'c');
  assertEquals(await client.zcard('zset'), 3);
  await client.zremrangebyscore('zset', 0, 150);
  assertEquals(await client.zcard('zset'), 2);
  await client.del('zset');
  await client.close();
});
