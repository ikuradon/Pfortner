import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { rateLimitPlugin } from './RateLimitPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const REDIS_URL = Deno.env.get('REDIS_URL');

const infra = buildInfraContext({});
const makeEvent = (id = 'e1') => ({ id, pubkey: 'pk', kind: 1, created_at: 0, tags: [], content: '', sig: '' });

const mockInstance = (authorized = false, ip = '127.0.0.1'): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: {
    connectionId: 'conn-1',
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
