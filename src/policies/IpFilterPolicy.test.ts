import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { ipFilterPlugin } from './IpFilterPolicy.ts';
import { buildInfraContext } from '../infra/context.ts';
import type { PfortnerInstance } from '../plugins/types.ts';

const infra = buildInfraContext({});
const makeInstance = (ip: string): PfortnerInstance => ({
  sendAuthMessage: () => {},
  sendMessageToClient: async () => {},
  connectionInfo: { connectionId: 'test', connectionIpAddr: ip, clientAuthorized: false, clientPubkey: '' },
});

Deno.test('ipFilter passes non-blacklisted IP', async () => {
  const factory = await ipFilterPlugin.initialize({ blacklist: { ips: ['1.2.3.4'] } }, infra);
  const inst = makeInstance('5.6.7.8');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});

Deno.test('ipFilter rejects blacklisted IP', async () => {
  const factory = await ipFilterPlugin.initialize({ blacklist: { ips: ['1.2.3.4'] } }, infra);
  const inst = makeInstance('1.2.3.4');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'reject');
});

Deno.test('ipFilter rejects IP in CIDR range', async () => {
  const factory = await ipFilterPlugin.initialize({ blacklist: { cidrs: ['10.0.0.0/8'] } }, infra);
  const inst = makeInstance('10.1.2.3');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'reject');
});

Deno.test('ipFilter passes IP outside CIDR range', async () => {
  const factory = await ipFilterPlugin.initialize({ blacklist: { cidrs: ['10.0.0.0/8'] } }, infra);
  const inst = makeInstance('192.168.1.1');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});

Deno.test('ipFilter caches result per connection', async () => {
  const factory = await ipFilterPlugin.initialize({ blacklist: { ips: ['1.2.3.4'] } }, infra);
  const inst = makeInstance('1.2.3.4');
  const policy = factory(inst);
  const r1 = await policy(['EVENT', { id: 'e1' }], inst.connectionInfo);
  const r2 = await policy(['REQ', 'sub1', {}], inst.connectionInfo);
  assertEquals(r1.action, 'reject');
  assertEquals(r2.action, 'reject'); // all messages rejected after first check
});

Deno.test('ipFilter with empty blacklist passes all', async () => {
  const factory = await ipFilterPlugin.initialize({ blacklist: {} }, infra);
  const inst = makeInstance('1.2.3.4');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});

Deno.test('ipFilter block_tor adds fetched exit nodes to blacklist', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: async () => new Response('1.2.3.4\n5.6.7.8\n# comment\n', { status: 200 }),
  };
  const factory = await ipFilterPlugin.initialize({ block_tor: true }, mockInfra);
  const inst = makeInstance('1.2.3.4');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'reject');
});

Deno.test('ipFilter block_tor gracefully handles fetch failure', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: async () => {
      throw new Error('network error');
    },
  };
  const factory = await ipFilterPlugin.initialize({ block_tor: true }, mockInfra);
  const inst = makeInstance('1.2.3.4');
  // Should pass since tor list fetch failed — don't block legitimate users
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});
