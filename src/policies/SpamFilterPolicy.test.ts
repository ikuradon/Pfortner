import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { spamFilterPlugin } from './SpamFilterPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import { nostrTools } from '../deps.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

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

const signingKey = nostrTools.generateSecretKey();
const makeSignedEvent = (overrides: Record<string, unknown> = {}) =>
  nostrTools.finalizeEvent({
    kind: 1,
    created_at: 1,
    tags: [],
    content: 'hello',
    ...overrides,
  }, signingKey);
const clearSpamFilterState = () => spamFilterPlugin.destroy?.() ?? Promise.resolve();

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
  await clearSpamFilterState();
  const factory = await spamFilterPlugin.initialize({ reject_duplicate: { enabled: true, window: 300 } }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  const event = makeSignedEvent({ content: 'dup1' });
  assertEquals((await policy(['EVENT', event], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', event], inst.connectionInfo)).action, 'reject');
});

Deno.test('spamFilter allows different event IDs', async () => {
  await clearSpamFilterState();
  const factory = await spamFilterPlugin.initialize({ reject_duplicate: { enabled: true, window: 300 } }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeSignedEvent({ content: 'a' })], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeSignedEvent({ content: 'b' })], inst.connectionInfo)).action, 'next');
});

Deno.test('spamFilter does not cache invalid duplicate event IDs', async () => {
  await clearSpamFilterState();
  const factory = await spamFilterPlugin.initialize({ reject_duplicate: { enabled: true, window: 300 } }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  const validEvent = makeSignedEvent({ content: 'legitimate event' });
  const forgedEvent = { ...validEvent, content: 'tampered after signing' };

  assertEquals((await policy(['EVENT', forgedEvent], inst.connectionInfo)).action, 'reject');
  assertEquals((await policy(['EVENT', validEvent], inst.connectionInfo)).action, 'next');
});

Deno.test('spamFilter rejects malformed duplicate events without throwing', async () => {
  await clearSpamFilterState();
  const factory = await spamFilterPlugin.initialize({ reject_duplicate: { enabled: true, window: 300 } }, infra);
  const inst = mockInstance();
  const policy = factory(inst);

  assertEquals((await policy(['EVENT', null], inst.connectionInfo)).action, 'reject');
});

Deno.test('spamFilter duplicate cache evicts oldest IDs when max_cache_size is reached', async () => {
  await clearSpamFilterState();
  const factory = await spamFilterPlugin.initialize({
    reject_duplicate: { enabled: true, window: 300, max_cache_size: 2 },
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  const first = makeSignedEvent({ content: 'first' });
  const second = makeSignedEvent({ content: 'second' });
  const third = makeSignedEvent({ content: 'third' });

  assertEquals((await policy(['EVENT', first], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', second], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', third], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', first], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', third], inst.connectionInfo)).action, 'reject');
});

Deno.test('spamFilter duplicate cleanup does not assume monotonic wall clock', async () => {
  await clearSpamFilterState();
  const originalNow = Date.now;
  const factory = await spamFilterPlugin.initialize({
    reject_duplicate: { enabled: true, window: 10, max_cache_size: 10 },
  }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  const first = makeSignedEvent({ content: 'clock-first' });
  const second = makeSignedEvent({ content: 'clock-second' });

  try {
    Date.now = () => 100_000;
    assertEquals((await policy(['EVENT', first], inst.connectionInfo)).action, 'next');
    Date.now = () => 50_000;
    assertEquals((await policy(['EVENT', second], inst.connectionInfo)).action, 'next');
    Date.now = () => 90_000;
    assertEquals((await policy(['EVENT', second], inst.connectionInfo)).action, 'next');
  } finally {
    Date.now = originalNow;
    await clearSpamFilterState();
  }
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
  const event = makeEvent({ id: 'nodupcheck' });
  assertEquals((await policy(['EVENT', event], inst.connectionInfo)).action, 'next');
  // Same ID again should pass because duplicate check is disabled
  assertEquals((await policy(['EVENT', event], inst.connectionInfo)).action, 'next');
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
    const event = makeSignedEvent({ content: 'redis-dup-1' });
    assertEquals((await policy(['EVENT', event], inst.connectionInfo)).action, 'next');
    assertEquals((await policy(['EVENT', event], inst.connectionInfo)).action, 'reject');

    await redis.del(`seen:${event.id}`);
    await redis.close();
  },
});
