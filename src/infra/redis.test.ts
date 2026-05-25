import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createRedisClient } from './redis.ts';

const REDIS_URL = Deno.env.get('REDIS_URL');
const skipRedis = !REDIS_URL;

async function waitForRedisKeyToExpire(
  client: Awaited<ReturnType<typeof createRedisClient>>,
  key: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await client.get(key) === null) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assertEquals(await client.get(key), null);
}

Deno.test({
  name: 'redis get/set with TTL',
  ignore: skipRedis,
  async fn() {
    const client = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test:' });
    await client.set('key1', 'value1', 5);
    assertEquals(await client.get('key1'), 'value1');
    await client.del('key1');
    assertEquals(await client.get('key1'), null);
    await client.close();
  },
});

Deno.test({
  name: 'redis setIfAbsent only writes missing keys',
  ignore: skipRedis,
  async fn() {
    const client = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test:' });
    await client.del('key-nx');
    assertEquals(await client.setIfAbsent('key-nx', 'value1', 5), true);
    assertEquals(await client.setIfAbsent('key-nx', 'value2', 5), false);
    assertEquals(await client.get('key-nx'), 'value1');
    await client.del('key-nx');
    await client.close();
  },
});

Deno.test({
  name: 'redis setIfAbsent treats zero TTL as expiring',
  ignore: skipRedis,
  async fn() {
    const client = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test:' });
    await client.del('key-nx-zero-ttl');
    assertEquals(await client.setIfAbsent('key-nx-zero-ttl', 'value1', 0), true);
    assertEquals(await client.get('key-nx-zero-ttl'), 'value1');
    await waitForRedisKeyToExpire(client, 'key-nx-zero-ttl');
    await client.close();
  },
});

Deno.test({
  name: 'redis incr',
  ignore: skipRedis,
  async fn() {
    const client = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test:' });
    await client.del('counter1');
    assertEquals(await client.incr('counter1'), 1);
    assertEquals(await client.incr('counter1'), 2);
    await client.del('counter1');
    await client.close();
  },
});

Deno.test({
  name: 'redis sadd/sismember',
  ignore: skipRedis,
  async fn() {
    const client = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test:' });
    await client.del('set1');
    await client.sadd('set1', 'a', 'b');
    assertEquals(await client.sismember('set1', 'a'), true);
    assertEquals(await client.sismember('set1', 'c'), false);
    await client.del('set1');
    await client.close();
  },
});

Deno.test({
  name: 'redis zadd/zcard/zremrangebyscore',
  ignore: skipRedis,
  async fn() {
    const client = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test:' });
    await client.del('zset1');
    await client.zadd('zset1', 100, 'a');
    await client.zadd('zset1', 200, 'b');
    await client.zadd('zset1', 300, 'c');
    assertEquals(await client.zcard('zset1'), 3);
    await client.zremrangebyscore('zset1', 0, 150);
    assertEquals(await client.zcard('zset1'), 2);
    await client.del('zset1');
    await client.close();
  },
});

Deno.test({
  name: 'redis key prefix isolation',
  ignore: skipRedis,
  async fn() {
    const client1 = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'ns1:' });
    const client2 = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'ns2:' });
    await client1.set('shared', 'from-ns1');
    await client2.set('shared', 'from-ns2');
    assertEquals(await client1.get('shared'), 'from-ns1');
    assertEquals(await client2.get('shared'), 'from-ns2');
    await client1.del('shared');
    await client2.del('shared');
    await client1.close();
    await client2.close();
  },
});
