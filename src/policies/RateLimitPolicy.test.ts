import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { __testing, rateLimitPlugin } from './RateLimitPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const REDIS_URL = Deno.env.get('REDIS_URL');

const infra = buildInfraContext({});
const makeEvent = (id = 'e1') => ({ id, pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' });

const mockInstance = (authorized = false, ip = '127.0.0.1', connectionId = 'conn-1'): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: {
    connectionId,
    connectionIpAddr: ip,
    clientAuthorized: authorized,
    clientPubkey: authorized ? 'pubkey123' : '',
  },
});

Deno.test('rateLimit passes CLOSE messages', async () => {
  const factory = await rateLimitPlugin.initialize({ scope: 'connection', window: 60, max_events: 1 }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['CLOSE', 'sub1'], inst.connectionInfo)).action, 'next');
});

Deno.test('rateLimit rejects EVENT after exceeding max_events', async () => {
  const factory = await rateLimitPlugin.initialize({
    scope: 'connection',
    window: 60,
    max_events: 2,
    max_requests: 100,
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent('e1')], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent('e2')], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent('e3')], inst.connectionInfo)).action, 'reject');
});

Deno.test('rateLimit rejects REQ after exceeding max_requests', async () => {
  const factory = await rateLimitPlugin.initialize({
    scope: 'connection',
    window: 60,
    max_events: 100,
    max_requests: 1,
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['REQ', 'sub1', {}], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['REQ', 'sub2', {}], inst.connectionInfo)).action, 'reject');
});

Deno.test('rateLimit scope ip shares limits across connections from same IP', async () => {
  const factory = await rateLimitPlugin.initialize({ scope: 'ip', window: 60, max_events: 2 }, infra);
  const inst1 = mockInstance(false, '1.2.3.4');
  const inst2 = mockInstance(false, '1.2.3.4');
  const policy1 = factory(inst1);
  const policy2 = factory(inst2);
  assertEquals((await policy1(['EVENT', makeEvent('e1')], inst1.connectionInfo)).action, 'next');
  assertEquals((await policy2(['EVENT', makeEvent('e2')], inst2.connectionInfo)).action, 'next');
  assertEquals((await policy1(['EVENT', makeEvent('e3')], inst1.connectionInfo)).action, 'reject');
});

Deno.test('rateLimit scope connection keeps counters per policy instance', async () => {
  const factory = await rateLimitPlugin.initialize({ scope: 'connection', window: 60, max_events: 1 }, infra);
  const inst1 = mockInstance();
  const inst2 = mockInstance();
  const policy1 = factory(inst1);
  const policy2 = factory(inst2);

  assertEquals((await policy1(['EVENT', makeEvent('e1')], inst1.connectionInfo)).action, 'next');
  assertEquals((await policy1(['EVENT', makeEvent('e2')], inst1.connectionInfo)).action, 'reject');
  assertEquals((await policy2(['EVENT', makeEvent('e3')], inst2.connectionInfo)).action, 'next');
});

Deno.test('rateLimit scope pubkey falls back to ip when unauthenticated', async () => {
  const factory = await rateLimitPlugin.initialize({ scope: 'pubkey', window: 60, max_events: 1 }, infra);
  const inst = mockInstance(false, '5.6.7.8');
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent('e1')], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent('e2')], inst.connectionInfo)).action, 'reject');
});

Deno.test('rateLimit custom reject message', async () => {
  const factory = await rateLimitPlugin.initialize({
    scope: 'connection',
    window: 60,
    max_events: 0,
    on_reject: { message: 'slow down' },
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  const result = await policy(['EVENT', makeEvent()], inst.connectionInfo);
  assertEquals(result.action, 'reject');
  assertEquals(result.response?.includes('slow down'), true);
});

Deno.test('rateLimit default max_events/max_requests (Infinity) allows all messages', async () => {
  // When max_events and max_requests are not set, defaults to Infinity
  const factory = await rateLimitPlugin.initialize({ scope: 'connection', window: 60 }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  // Send many events and requests without hitting limits
  for (let i = 0; i < 20; i++) {
    assertEquals((await policy(['EVENT', makeEvent(`e${i}`)], inst.connectionInfo)).action, 'next');
    assertEquals((await policy(['REQ', `sub${i}`, {}], inst.connectionInfo)).action, 'next');
  }
});

Deno.test('rateLimit destroy clears shared counters', async () => {
  const factory = await rateLimitPlugin.initialize({ scope: 'ip', window: 60, max_events: 1 }, infra);
  const inst = mockInstance(false, '10.0.0.1');
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent('e1')], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent('e2')], inst.connectionInfo)).action, 'reject');

  // After destroy, counters should be cleared
  await rateLimitPlugin.destroy!();

  const factory2 = await rateLimitPlugin.initialize({ scope: 'ip', window: 60, max_events: 1 }, infra);
  const inst2 = mockInstance(false, '10.0.0.1');
  const policy2 = factory2(inst2);
  // Should be allowed again after counters cleared
  assertEquals((await policy2(['EVENT', makeEvent('e3')], inst2.connectionInfo)).action, 'next');
});

Deno.test('rateLimit scope pubkey with authenticated client uses pubkey as key', async () => {
  // Two authenticated connections with the same pubkey should share limits
  const factory = await rateLimitPlugin.initialize({ scope: 'pubkey', window: 60, max_events: 2 }, infra);
  const inst1 = mockInstance(true, '1.1.1.1');
  const inst2 = mockInstance(true, '2.2.2.2');
  // Both have clientPubkey = 'pubkey123' (from mockInstance with authorized=true)
  const policy1 = factory(inst1);
  const policy2 = factory(inst2);
  assertEquals((await policy1(['EVENT', makeEvent('e1')], inst1.connectionInfo)).action, 'next');
  assertEquals((await policy2(['EVENT', makeEvent('e2')], inst2.connectionInfo)).action, 'next');
  // Third event from either connection sharing same pubkey should be rejected
  assertEquals((await policy1(['EVENT', makeEvent('e3')], inst1.connectionInfo)).action, 'reject');
});

Deno.test('rateLimit memory backend evicts expired ip scope counters', async () => {
  await rateLimitPlugin.destroy!();
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const factory = await rateLimitPlugin.initialize({ scope: 'ip', window: 1, max_events: 1 }, infra);
    for (let i = 0; i < 5; i++) {
      const inst = mockInstance(false, `10.0.0.${i}`);
      const policy = factory(inst);
      assertEquals((await policy(['EVENT', makeEvent(`ip-${i}`)], inst.connectionInfo)).action, 'next');
    }
    assertEquals(__testing.sharedCounterCount(), 5);

    now += 1_001;
    const fresh = mockInstance(false, '10.0.0.99');
    const freshPolicy = factory(fresh);
    assertEquals((await freshPolicy(['EVENT', makeEvent('fresh-ip')], fresh.connectionInfo)).action, 'next');

    assertEquals(__testing.sharedCounterCount(), 1);
  } finally {
    Date.now = originalNow;
    await rateLimitPlugin.destroy!();
  }
});

Deno.test('rateLimit memory backend evicts expired authenticated pubkey scope counters', async () => {
  await rateLimitPlugin.destroy!();
  const originalNow = Date.now;
  let now = 2_000_000;
  Date.now = () => now;
  try {
    const factory = await rateLimitPlugin.initialize({ scope: 'pubkey', window: 1, max_events: 1 }, infra);
    for (let i = 0; i < 5; i++) {
      const inst = mockInstance(true, '10.0.0.1', `conn-pk-${i}`);
      inst.connectionInfo.clientPubkey = `pk-${i}`;
      const policy = factory(inst);
      assertEquals((await policy(['EVENT', makeEvent(`pubkey-${i}`)], inst.connectionInfo)).action, 'next');
    }
    assertEquals(__testing.sharedCounterCount(), 5);

    now += 1_001;
    const fresh = mockInstance(true, '10.0.0.1', 'conn-pk-fresh');
    fresh.connectionInfo.clientPubkey = 'pk-fresh';
    const freshPolicy = factory(fresh);
    assertEquals((await freshPolicy(['EVENT', makeEvent('fresh-pubkey')], fresh.connectionInfo)).action, 'next');

    assertEquals(__testing.sharedCounterCount(), 1);
  } finally {
    Date.now = originalNow;
    await rateLimitPlugin.destroy!();
  }
});

Deno.test('rateLimit memory backend does not track message types without limits', async () => {
  await rateLimitPlugin.destroy!();
  try {
    const factory = await rateLimitPlugin.initialize({ scope: 'ip', window: 60, max_events: 1 }, infra);
    const inst = mockInstance(false, '10.0.0.200');
    const policy = factory(inst);
    for (let i = 0; i < 5; i++) {
      assertEquals((await policy(['REQ', `sub-${i}`, {}], inst.connectionInfo)).action, 'next');
    }

    assertEquals(__testing.sharedCountersForKey('ip:10.0.0.200'), undefined);
  } finally {
    await rateLimitPlugin.destroy!();
  }
});

Deno.test({
  name: 'rateLimit with redis backend shares state',
  ignore: !REDIS_URL,
  async fn() {
    const { createRedisClient } = await import('../infra/redis.ts');
    const redis = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test-rl:' });
    const testInfra = { ...infra, redis };

    const factory = await rateLimitPlugin.initialize({
      scope: 'ip',
      window: 60,
      max_events: 2,
      backend: 'redis',
    }, testInfra);
    const inst = mockInstance(false, '99.99.99.99');
    const policy = factory(inst);
    assertEquals((await policy(['EVENT', makeEvent('e1')], inst.connectionInfo)).action, 'next');
    assertEquals((await policy(['EVENT', makeEvent('e2')], inst.connectionInfo)).action, 'next');
    assertEquals((await policy(['EVENT', makeEvent('e3')], inst.connectionInfo)).action, 'reject');

    // Cleanup
    await redis.del('events:ip:99.99.99.99', 'requests:ip:99.99.99.99');
    await redis.close();
  },
});

Deno.test({
  name: 'rateLimit with redis backend scopes connection keys by connectionId',
  ignore: !REDIS_URL,
  async fn() {
    const { createRedisClient } = await import('../infra/redis.ts');
    const redis = await createRedisClient({ url: REDIS_URL!, keyPrefix: 'test-rl-conn:' });
    const testInfra = { ...infra, redis };

    const factory = await rateLimitPlugin.initialize({
      scope: 'connection',
      window: 60,
      max_events: 1,
      backend: 'redis',
    }, testInfra);

    // Redis scopes connection limits by connectionId, not by IP or policy instance.
    // inst2 intentionally reuses inst1's connectionId to prove the shared Redis bucket.
    const inst1 = mockInstance(false, '99.99.99.99', 'redis-conn-1');
    const inst2 = mockInstance(false, '88.88.88.88', 'redis-conn-1');
    const inst3 = mockInstance(false, '77.77.77.77', 'redis-conn-2');
    const policy1 = factory(inst1);
    const policy2 = factory(inst2);
    const policy3 = factory(inst3);

    assertEquals((await policy1(['EVENT', makeEvent('redis-conn-1')], inst1.connectionInfo)).action, 'next');
    assertEquals((await policy2(['EVENT', makeEvent('redis-conn-2')], inst2.connectionInfo)).action, 'reject');
    assertEquals((await policy3(['EVENT', makeEvent('redis-conn-3')], inst3.connectionInfo)).action, 'next');

    await redis.del('events:conn:redis-conn-1', 'requests:conn:redis-conn-1');
    await redis.del('events:conn:redis-conn-2', 'requests:conn:redis-conn-2');
    await redis.close();
  },
});
