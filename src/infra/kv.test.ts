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

Deno.test('kv sweeps expired TTL data keys during unrelated operations', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'pfortner-kv-test-' });
  const path = `${dir}/kv.db`;
  const client = await createKvClient({ path });

  await client.set('seen:unique-event', '1', 0.05);
  await new Promise((r) => setTimeout(r, 100));
  await client.set('seen:another-event', '1', 10);
  await client.close();

  const kv = await Deno.openKv(path);
  const expired = await kv.get(['data', 'seen:unique-event']);
  const active = await kv.get(['data', 'seen:another-event']);
  assertEquals(expired.value, null);
  assertEquals(active.value != null, true);
  kv.close();
});

Deno.test('kv del removes expiry index entries', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'pfortner-kv-test-' });
  const path = `${dir}/kv.db`;
  const client = await createKvClient({ path });

  await client.set('ttl-key', 'value', 10);
  await client.zadd('ttl-zset', 1, 'member-1');
  await client.expire('ttl-zset', 10);
  await client.del('ttl-key', 'ttl-zset');
  await client.close();

  const kv = await Deno.openKv(path);
  let indexCount = 0;
  for await (const _entry of kv.list({ prefix: ['expires'] })) indexCount++;
  assertEquals(indexCount, 0);
  kv.close();
});

Deno.test('kv expire applies to sorted set members', async () => {
  const client = await createKvClient({ path: ':memory:' });

  await client.zadd('events:conn:attacker', Date.now(), 'member-1');
  assertEquals(await client.zcard('events:conn:attacker'), 1);
  await client.expire('events:conn:attacker', 0.05);
  await new Promise((r) => setTimeout(r, 100));

  assertEquals(await client.zcard('events:conn:attacker'), 0);
  await client.close();
});

Deno.test('kv incr preserves an existing TTL', async () => {
  const client = await createKvClient({ path: ':memory:' });

  assertEquals(await client.incr('counter-with-ttl'), 1);
  await client.expire('counter-with-ttl', 0.08);
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(await client.incr('counter-with-ttl'), 2);
  await new Promise((r) => setTimeout(r, 70));

  assertEquals(await client.get('counter-with-ttl'), null);
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
