import { assertEquals } from '@std/assert';
import { protectedEventPlugin } from './ProtectedEventPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const infra = buildInfraContext({});
const makeInstance = (authorized: boolean): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: {
    connectionId: 'test',
    connectionIpAddr: '127.0.0.1',
    clientAuthorized: authorized,
    clientPubkey: authorized ? 'pk' : '',
  },
});
const makeEvent = (tags: string[][] = []) => ({
  id: 'e1',
  pubkey: 'pk',
  kind: 1,
  created_at: 0,
  tags,
  content: '',
  sig: '',
});

Deno.test('protectedEvent passes non-EVENT messages', async () => {
  const factory = await protectedEventPlugin.initialize({ require_auth: true }, infra);
  assertEquals(
    (await factory(makeInstance(false))(['NOTICE', 'hello'], makeInstance(false).connectionInfo)).action,
    'next',
  );
});

Deno.test('protectedEvent passes events without - tag', async () => {
  const factory = await protectedEventPlugin.initialize({ require_auth: true }, infra);
  const inst = makeInstance(false);
  assertEquals(
    (await factory(inst)(['EVENT', 'sub1', makeEvent([['p', 'someone']])], inst.connectionInfo)).action,
    'next',
  );
});

Deno.test('protectedEvent rejects protected event for unauthenticated client', async () => {
  const factory = await protectedEventPlugin.initialize({ require_auth: true }, infra);
  const inst = makeInstance(false);
  assertEquals((await factory(inst)(['EVENT', 'sub1', makeEvent([['-']])], inst.connectionInfo)).action, 'reject');
});

Deno.test('protectedEvent passes protected event for authenticated client', async () => {
  const factory = await protectedEventPlugin.initialize({ require_auth: true }, infra);
  const inst = makeInstance(true);
  assertEquals((await factory(inst)(['EVENT', 'sub1', makeEvent([['-']])], inst.connectionInfo)).action, 'next');
});

Deno.test('protectedEvent require_auth: false passes all messages including protected events', async () => {
  const factory = await protectedEventPlugin.initialize({ require_auth: false }, infra);
  const inst = makeInstance(false);
  // Even a protected event with '-' tag passes when require_auth is false
  assertEquals(
    (await factory(inst)(['EVENT', 'sub1', makeEvent([['-']])], inst.connectionInfo)).action,
    'next',
  );
});

Deno.test('protectedEvent with undefined tags does not crash', async () => {
  const factory = await protectedEventPlugin.initialize({ require_auth: true }, infra);
  const inst = makeInstance(false);
  const eventWithUndefinedTags = {
    id: 'e1',
    pubkey: 'pk',
    kind: 1,
    created_at: 0,
    tags: undefined,
    content: '',
    sig: '',
  };
  // Should not throw; event without tags is not protected
  const result = await factory(inst)(['EVENT', 'sub1', eventWithUndefinedTags], inst.connectionInfo);
  assertEquals(result.action, 'next');
});
