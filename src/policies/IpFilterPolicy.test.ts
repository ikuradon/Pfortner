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

Deno.test('ipFilter passes non-blocklisted IP', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: { ips: ['1.2.3.4'] } }, infra);
  const inst = makeInstance('5.6.7.8');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});

Deno.test('ipFilter rejects blocklisted IP', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: { ips: ['1.2.3.4'] } }, infra);
  const inst = makeInstance('1.2.3.4');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'reject');
});

Deno.test('ipFilter rejects IP in CIDR range', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: { cidrs: ['10.0.0.0/8'] } }, infra);
  const inst = makeInstance('10.1.2.3');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'reject');
});

Deno.test('ipFilter passes IP outside CIDR range', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: { cidrs: ['10.0.0.0/8'] } }, infra);
  const inst = makeInstance('192.168.1.1');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});

Deno.test('ipFilter caches result per connection', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: { ips: ['1.2.3.4'] } }, infra);
  const inst = makeInstance('1.2.3.4');
  const policy = factory(inst);
  const r1 = await policy(['EVENT', { id: 'e1' }], inst.connectionInfo);
  const r2 = await policy(['REQ', 'sub1', {}], inst.connectionInfo);
  assertEquals(r1.action, 'reject');
  assertEquals(r2.action, 'reject'); // all messages rejected after first check
});

Deno.test('ipFilter with empty blocklist passes all', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: {} }, infra);
  const inst = makeInstance('1.2.3.4');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});

Deno.test('ipFilter block_tor adds fetched exit nodes to blocklist', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: () => Promise.resolve(new Response('1.2.3.4\n5.6.7.8\n# comment\n', { status: 200 })),
  };
  const factory = await ipFilterPlugin.initialize({ block_tor: true }, mockInfra);
  const inst = makeInstance('1.2.3.4');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'reject');
});

Deno.test('ipFilter block_tor gracefully handles fetch failure', async () => {
  const mockInfra = buildInfraContext({});
  mockInfra.httpClient = {
    fetch: () => Promise.reject(new Error('network error')),
  };
  const factory = await ipFilterPlugin.initialize({ block_tor: true }, mockInfra);
  const inst = makeInstance('1.2.3.4');
  // Should pass since tor list fetch failed — don't block legitimate users
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});

Deno.test('ipFilter CIDR /32 matches exact IP only', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: { cidrs: ['192.168.1.100/32'] } }, infra);
  const instMatch = makeInstance('192.168.1.100');
  const instNoMatch = makeInstance('192.168.1.101');
  assertEquals((await factory(instMatch)(['EVENT', { id: 'e1' }], instMatch.connectionInfo)).action, 'reject');
  assertEquals((await factory(instNoMatch)(['EVENT', { id: 'e1' }], instNoMatch.connectionInfo)).action, 'next');
});

Deno.test('ipFilter CIDR /0 matches all IPs', async () => {
  const factory = await ipFilterPlugin.initialize({ blocklist: { cidrs: ['0.0.0.0/0'] } }, infra);
  const inst1 = makeInstance('1.2.3.4');
  const inst2 = makeInstance('192.168.1.1');
  const inst3 = makeInstance('10.0.0.1');
  assertEquals((await factory(inst1)(['EVENT', { id: 'e1' }], inst1.connectionInfo)).action, 'reject');
  assertEquals((await factory(inst2)(['EVENT', { id: 'e1' }], inst2.connectionInfo)).action, 'reject');
  assertEquals((await factory(inst3)(['EVENT', { id: 'e1' }], inst3.connectionInfo)).action, 'reject');
});

Deno.test('ipFilter multiple CIDRs: match if any matches', async () => {
  const factory = await ipFilterPlugin.initialize({
    blocklist: { cidrs: ['10.0.0.0/8', '192.168.0.0/16'] },
  }, infra);
  const instMatch1 = makeInstance('10.5.6.7');
  const instMatch2 = makeInstance('192.168.1.50');
  const instNoMatch = makeInstance('172.16.0.1');
  assertEquals((await factory(instMatch1)(['EVENT', { id: 'e1' }], instMatch1.connectionInfo)).action, 'reject');
  assertEquals((await factory(instMatch2)(['EVENT', { id: 'e1' }], instMatch2.connectionInfo)).action, 'reject');
  assertEquals((await factory(instNoMatch)(['EVENT', { id: 'e1' }], instNoMatch.connectionInfo)).action, 'next');
});

Deno.test('ipFilter block_countries without geoip_db silently skips GeoIP', async () => {
  // When geoip_db is not provided, block_countries should be silently ignored
  const factory = await ipFilterPlugin.initialize({ block_countries: ['XX'] }, infra);
  const inst = makeInstance('1.2.3.4');
  assertEquals((await factory(inst)(['EVENT', { id: 'e1' }], inst.connectionInfo)).action, 'next');
});
