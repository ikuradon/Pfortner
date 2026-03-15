import { assertEquals } from 'jsr:@std/assert@1.0.18';
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
