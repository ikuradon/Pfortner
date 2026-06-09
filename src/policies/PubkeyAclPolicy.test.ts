import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { pubkeyAclPlugin } from './PubkeyAclPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const infra = buildInfraContext({});
const makeInstance = (authorized = false, pubkey = 'authorized-pk'): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: {
    connectionId: 'test',
    connectionIpAddr: '127.0.0.1',
    clientAuthorized: authorized,
    clientPubkey: authorized ? pubkey : '',
  },
});
const makeEvent = (pubkey: string) => ({
  id: 'e1',
  pubkey,
  kind: 1,
  created_at: 0,
  tags: [],
  content: 'hi',
  sig: '',
});

Deno.test('pubkeyAcl passes non-EVENT messages', async () => {
  const factory = await pubkeyAclPlugin.initialize({ mode: 'allowlist', target: 'author', pubkeys: ['pk1'] }, infra);
  const inst = makeInstance();
  assertEquals((await factory(inst)(['REQ', 'sub1', {}], inst.connectionInfo)).action, 'next');
});

Deno.test('pubkeyAcl allowlist author allows matching pubkey', async () => {
  const factory = await pubkeyAclPlugin.initialize(
    { mode: 'allowlist', target: 'author', pubkeys: ['pk1', 'pk2'] },
    infra,
  );
  const inst = makeInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('pk1')], inst.connectionInfo)).action, 'next');
});

Deno.test('pubkeyAcl allowlist author rejects non-matching pubkey', async () => {
  const factory = await pubkeyAclPlugin.initialize({ mode: 'allowlist', target: 'author', pubkeys: ['pk1'] }, infra);
  const inst = makeInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('pk-unknown')], inst.connectionInfo)).action, 'reject');
});

Deno.test('pubkeyAcl blocklist author rejects matching pubkey', async () => {
  const factory = await pubkeyAclPlugin.initialize({ mode: 'blocklist', target: 'author', pubkeys: ['bad-pk'] }, infra);
  const inst = makeInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('bad-pk')], inst.connectionInfo)).action, 'reject');
});

Deno.test('pubkeyAcl blocklist author allows non-matching pubkey', async () => {
  const factory = await pubkeyAclPlugin.initialize({ mode: 'blocklist', target: 'author', pubkeys: ['bad-pk'] }, infra);
  const inst = makeInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('good-pk')], inst.connectionInfo)).action, 'next');
});

Deno.test('pubkeyAcl target client checks connectionInfo pubkey', async () => {
  const factory = await pubkeyAclPlugin.initialize(
    { mode: 'allowlist', target: 'client', pubkeys: ['authorized-pk'] },
    infra,
  );
  const inst = makeInstance(true, 'authorized-pk');
  assertEquals((await factory(inst)(['EVENT', makeEvent('any-author')], inst.connectionInfo)).action, 'next');
});

Deno.test('pubkeyAcl target client rejects unauthenticated in allowlist mode', async () => {
  const factory = await pubkeyAclPlugin.initialize({ mode: 'allowlist', target: 'client', pubkeys: ['pk1'] }, infra);
  const inst = makeInstance(false);
  assertEquals((await factory(inst)(['EVENT', makeEvent('any')], inst.connectionInfo)).action, 'reject');
});

Deno.test('pubkeyAcl works in server direction (3-element EVENT)', async () => {
  const factory = await pubkeyAclPlugin.initialize({ mode: 'blocklist', target: 'author', pubkeys: ['bad-pk'] }, infra);
  const inst = makeInstance();
  assertEquals((await factory(inst)(['EVENT', 'sub1', makeEvent('bad-pk')], inst.connectionInfo)).action, 'reject');
});

Deno.test('pubkeyAcl empty pubkeys + allowlist mode: all events rejected', async () => {
  const factory = await pubkeyAclPlugin.initialize({ mode: 'allowlist', target: 'author', pubkeys: [] }, infra);
  const inst = makeInstance();
  assertEquals((await factory(inst)(['EVENT', makeEvent('any-pk')], inst.connectionInfo)).action, 'reject');
  assertEquals((await factory(inst)(['EVENT', makeEvent('another-pk')], inst.connectionInfo)).action, 'reject');
});

Deno.test('pubkeyAcl target: client + blocklist mode + unauthenticated: passes (not in any blocklist)', async () => {
  const factory = await pubkeyAclPlugin.initialize(
    { mode: 'blocklist', target: 'client', pubkeys: ['bad-pk'] },
    infra,
  );
  const inst = makeInstance(false); // unauthenticated: clientPubkey is empty
  // Unauthenticated client in blocklist mode passes (empty pubkey is not in any blocklist)
  assertEquals((await factory(inst)(['EVENT', makeEvent('any-author')], inst.connectionInfo)).action, 'next');
});

Deno.test('pubkeyAcl with wot config allows static pubkeys even if relay unreachable', async () => {
  const factory = await pubkeyAclPlugin.initialize(
    {
      mode: 'allowlist',
      target: 'author',
      pubkeys: ['static-pk'],
      wot: { enabled: true, root_pubkeys: ['root'], max_depth: 1, relay_url: 'wss://127.0.0.1:19999' },
    },
    infra,
  );
  const inst = makeInstance();
  // 'static-pk' should still be allowed (static list always included regardless of WoT failure)
  assertEquals((await factory(inst)(['EVENT', makeEvent('static-pk')], inst.connectionInfo)).action, 'next');
  // unknown pubkey should be rejected (allowlist mode)
  assertEquals((await factory(inst)(['EVENT', makeEvent('unknown-pk')], inst.connectionInfo)).action, 'reject');
});
