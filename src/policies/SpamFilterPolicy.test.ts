import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { spamFilterPlugin } from './SpamFilterPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

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
