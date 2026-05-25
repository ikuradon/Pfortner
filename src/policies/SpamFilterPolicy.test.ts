import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { spamFilterPlugin } from './SpamFilterPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance, RedisClient } from '../plugins/types.ts';

const REDIS_URL = Deno.env.get('REDIS_URL');

const infra = buildInfraContext({});
const mockInstance = (): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: { connectionId: 'test', connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
});

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  pubkey: 'pk',
  kind: 1,
  created_at: 0,
  tags: [],
  content: 'hello',
  sig: '',
  ...overrides,
});

class MockRedis implements RedisClient {
  store = new Map<string, string>();
  setCalls: Array<{ key: string; value: string; ttl?: number }> = [];

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, ttl?: number): Promise<void> {
    this.setCalls.push({ key, value, ttl });
    this.store.set(key, value);
    return Promise.resolve();
  }

  setIfAbsent(key: string, value: string, ttl?: number): Promise<boolean> {
    this.setCalls.push({ key, value, ttl });
    if (this.store.has(key)) return Promise.resolve(false);
    this.store.set(key, value);
    return Promise.resolve(true);
  }

  incr(): Promise<number> {
    return Promise.resolve(0);
  }
  expire(): Promise<void> {
    return Promise.resolve();
  }
  sadd(): Promise<number> {
    return Promise.resolve(0);
  }
  sismember(): Promise<boolean> {
    return Promise.resolve(false);
  }
  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed++;
    }
    return Promise.resolve(removed);
  }
  zadd(): Promise<number> {
    return Promise.resolve(0);
  }
  zremrangebyscore(): Promise<number> {
    return Promise.resolve(0);
  }
  zcard(): Promise<number> {
    return Promise.resolve(0);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

Deno.test('spamFilter passes non-EVENT messages', async () => {
  const factory = await spamFilterPlugin.initialize({ max_content_length: 10 }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['REQ', 'sub1', {}], inst.connectionInfo)).action, 'next');
});

Deno.test('spamFilter rejects content exceeding max_content_length', async () => {
  const factory = await spamFilterPlugin.initialize({ max_content_length: 5 }, infra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent({ content: 'this is too long' })], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('spamFilter passes content within limit', async () => {
  const factory = await spamFilterPlugin.initialize({ max_content_length: 100 }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent({ content: 'ok' })], inst.connectionInfo)).action, 'next');
});

Deno.test('spamFilter rejects duplicate event ID', async () => {
  const factory = await spamFilterPlugin.initialize({ reject_duplicate: { enabled: true, window: 300 } }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent({ id: 'dup1' })], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent({ id: 'dup1' })], inst.connectionInfo)).action, 'reject');
});

Deno.test('spamFilter allows different event IDs', async () => {
  const factory = await spamFilterPlugin.initialize({ reject_duplicate: { enabled: true, window: 300 } }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent({ id: 'a' })], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent({ id: 'b' })], inst.connectionInfo)).action, 'next');
});

Deno.test('spamFilter min_pow 0 passes all events regardless of PoW', async () => {
  const factory = await spamFilterPlugin.initialize({ min_pow: 0 }, infra);
  const inst = mockInstance();
  // Event ID with no leading zero bits (e.g. 'ff...')
  const result = await factory(inst)(
    ['EVENT', makeEvent({ id: 'ffffffffffffffffffffffffffffffff' })],
    inst.connectionInfo,
  );
  assertEquals(result.action, 'next');
});

Deno.test('spamFilter max_content_length 0 rejects any content', async () => {
  const factory = await spamFilterPlugin.initialize({ max_content_length: 0 }, infra);
  const inst = mockInstance();
  const result = await factory(inst)(['EVENT', makeEvent({ content: 'a' })], inst.connectionInfo);
  assertEquals(result.action, 'reject');
});

Deno.test('spamFilter max_content_length uses byte length for multi-byte chars', async () => {
  // emoji '🎉' is 4 bytes, CJK char '中' is 3 bytes
  const factory = await spamFilterPlugin.initialize({ max_content_length: 3 }, infra);
  const inst = mockInstance();
  // '🎉' = 4 bytes > 3 → reject
  const emojiResult = await factory(inst)(['EVENT', makeEvent({ content: '🎉' })], inst.connectionInfo);
  assertEquals(emojiResult.action, 'reject');

  const factory2 = await spamFilterPlugin.initialize({ max_content_length: 3 }, infra);
  const inst2 = mockInstance();
  // '中' = 3 bytes → next (equal to limit, not exceeding)
  const cjkResult = await factory2(inst2)(['EVENT', makeEvent({ content: '中' })], inst2.connectionInfo);
  assertEquals(cjkResult.action, 'next');
});

Deno.test('spamFilter reject_duplicate enabled false skips duplicate check', async () => {
  const factory = await spamFilterPlugin.initialize({ reject_duplicate: { enabled: false, window: 300 } }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent({ id: 'nodupcheck' })], inst.connectionInfo)).action, 'next');
  // Same ID again should pass because duplicate check is disabled
  assertEquals((await policy(['EVENT', makeEvent({ id: 'nodupcheck' })], inst.connectionInfo)).action, 'next');
});

Deno.test('spamFilter redis duplicate detection rejects concurrent duplicate event IDs', async () => {
  const concurrent = 5;
  const redis = new MockRedis();
  const factory = await spamFilterPlugin.initialize({
    reject_duplicate: { enabled: true, window: 300, backend: 'redis' },
  }, { ...infra, redis });
  const inst = mockInstance();
  const policy = factory(inst);

  const results = await Promise.all(
    Array.from(
      { length: concurrent },
      () => policy(['EVENT', makeEvent({ id: 'redis-concurrent-dup' })], inst.connectionInfo),
    ),
  );

  assertEquals(results.map((result) => result.action), ['next', 'reject', 'reject', 'reject', 'reject']);
});

Deno.test('spamFilter redis duplicate detection uses default window when omitted', async () => {
  const redis = new MockRedis();
  const factory = await spamFilterPlugin.initialize({
    reject_duplicate: { enabled: true, backend: 'redis' },
  }, { ...infra, redis });
  const inst = mockInstance();

  await factory(inst)(['EVENT', makeEvent({ id: 'redis-default-window' })], inst.connectionInfo);

  assertEquals(redis.setCalls[0]?.ttl, 300);
});

Deno.test({
  name: 'spamFilter with redis duplicate detection',
  ignore: !REDIS_URL,
  async fn() {
    const { createRedisClient } = await import('../infra/redis.ts');
    const redis = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test-sf:' });
    const testInfra = { ...infra, redis };

    const factory = await spamFilterPlugin.initialize({
      reject_duplicate: { enabled: true, window: 300, backend: 'redis' },
    }, testInfra);
    const inst = mockInstance();
    const policy = factory(inst);
    assertEquals((await policy(['EVENT', makeEvent({ id: 'redis-dup-1' })], inst.connectionInfo)).action, 'next');
    assertEquals((await policy(['EVENT', makeEvent({ id: 'redis-dup-1' })], inst.connectionInfo)).action, 'reject');

    await redis.del('seen:redis-dup-1');
    await redis.close();
  },
});
