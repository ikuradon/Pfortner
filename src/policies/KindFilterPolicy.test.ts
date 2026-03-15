import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { kindFilterPlugin } from './KindFilterPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const infra = buildInfraContext({});

const mockInstance = (authorized = false): PfortnerInstance & { _authSent: boolean } => {
  let authSent = false;
  return {
    sendAuthMessage: () => {
      authSent = true;
    },
    sendMessageToClient: async () => {},
    connectionInfo: {
      connectionId: 'test',
      connectionIpAddr: '127.0.0.1',
      clientAuthorized: authorized,
      clientPubkey: authorized ? 'pubkey123' : '',
    },
    get _authSent() {
      return authSent;
    },
  } as PfortnerInstance & { _authSent: boolean };
};

const makeEvent = (kind: number) => ({ id: 'e1', pubkey: 'pk', kind, created_at: 0, tags: [], content: '', sig: '' });

Deno.test('kindFilter passes non-EVENT messages', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'deny', kinds: [4] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['REQ', 'sub1', { kinds: [4] }], inst.connectionInfo)).action, 'next');
});

Deno.test('kindFilter deny mode rejects matching kind', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'deny', kinds: [4, 1059] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent(4)], inst.connectionInfo)).action, 'reject');
});

Deno.test('kindFilter deny mode passes non-matching kind', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'deny', kinds: [4] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent(1)], inst.connectionInfo)).action, 'next');
});

Deno.test('kindFilter allow mode passes matching kind', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'allow', kinds: [1, 7] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent(1)], inst.connectionInfo)).action, 'next');
});

Deno.test('kindFilter allow mode rejects non-matching kind', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'allow', kinds: [1, 7] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent(30023)], inst.connectionInfo)).action, 'reject');
});

Deno.test('kindFilter require_auth_for rejects unauthenticated and sends AUTH', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'deny', kinds: [], require_auth_for: [4] }, infra);
  const inst = mockInstance(false);
  const policy = factory(inst);
  const result = await policy(['EVENT', makeEvent(4)], inst.connectionInfo);
  assertEquals(result.action, 'reject');
  assertEquals(result.response?.includes('auth-required'), true);
  assertEquals(inst._authSent, true);
});

Deno.test('kindFilter deny mode works in server direction (3-element EVENT)', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'deny', kinds: [4] }, infra);
  const inst = mockInstance();
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', 'sub1', makeEvent(4)], inst.connectionInfo)).action, 'reject');
});

Deno.test('kindFilter require_auth_for passes authenticated client', async () => {
  const factory = await kindFilterPlugin.initialize({ mode: 'deny', kinds: [], require_auth_for: [4] }, infra);
  const inst = mockInstance(true);
  const policy = factory(inst);
  assertEquals((await policy(['EVENT', makeEvent(4)], inst.connectionInfo)).action, 'next');
});
