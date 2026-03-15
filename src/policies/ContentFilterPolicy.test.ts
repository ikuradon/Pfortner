import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { contentFilterPlugin } from './ContentFilterPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const infra = buildInfraContext({});
const mockInstance = (): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: { connectionId: 'test', connectionIpAddr: '127.0.0.1', clientAuthorized: false, clientPubkey: '' },
});
const makeEvent = (content: string, kind = 1) => ({
  id: 'e1',
  pubkey: 'pk',
  kind,
  created_at: 0,
  tags: [],
  content,
  sig: '',
});

Deno.test('contentFilter passes non-EVENT messages', async () => {
  const factory = await contentFilterPlugin.initialize({ banned_words: ['spam'] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['REQ', 'sub1', {}], inst.connectionInfo)).action, 'next');
});

Deno.test('contentFilter rejects event with banned word', async () => {
  const factory = await contentFilterPlugin.initialize({ banned_words: ['spam', 'scam'] }, infra);
  const inst = mockInstance();
  assertEquals(
    (await factory(inst)(['EVENT', makeEvent('this is spam content')], inst.connectionInfo)).action,
    'reject',
  );
});

Deno.test('contentFilter passes clean content', async () => {
  const factory = await contentFilterPlugin.initialize({ banned_words: ['spam'] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('hello world')], inst.connectionInfo)).action, 'next');
});

Deno.test('contentFilter rejects event matching banned_patterns', async () => {
  const factory = await contentFilterPlugin.initialize(
    { banned_patterns: ['https?://malicious\\.example\\.com'] },
    infra,
  );
  const inst = mockInstance();
  assertEquals(
    (await factory(inst)(['EVENT', makeEvent('visit http://malicious.example.com')], inst.connectionInfo)).action,
    'reject',
  );
});

Deno.test('contentFilter apply_to_kinds only filters matching kinds', async () => {
  const factory = await contentFilterPlugin.initialize({ banned_words: ['spam'], apply_to_kinds: [1] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent('spam', 30023)], inst.connectionInfo)).action, 'next');
  assertEquals((await policy(['EVENT', makeEvent('spam', 1)], inst.connectionInfo)).action, 'reject');
});

Deno.test('contentFilter works in server direction (3-element EVENT)', async () => {
  const factory = await contentFilterPlugin.initialize({ banned_words: ['spam'] }, infra);
  const inst = mockInstance();
  assertEquals((await factory(inst)(['EVENT', 'sub1', makeEvent('spam')], inst.connectionInfo)).action, 'reject');
});

Deno.test('contentFilter banned_words is case-insensitive', async () => {
  const factory = await contentFilterPlugin.initialize({ banned_words: ['SPAM'] }, infra);
  const inst = mockInstance();
  assertEquals(
    (await factory(inst)(['EVENT', makeEvent('this has Spam in it')], inst.connectionInfo)).action,
    'reject',
  );
});
