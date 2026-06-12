import { assertEquals } from '@std/assert';
import {
  addLegacyBearerIp,
  addLegacyBearerPubkey,
  deleteLegacyBearerIp,
  deleteLegacyBearerPubkey,
} from './blocklist.ts';

Deno.test('legacy bearer blocklist actions keep truthy value semantics', () => {
  const blocklist = { pubkeys: new Set<string>(), ips: new Set<string>() };

  const pubkey = addLegacyBearerPubkey(blocklist, 123);
  const ip = addLegacyBearerIp(blocklist, 456);

  assertEquals(pubkey, { added: 123 });
  assertEquals(ip, { added: 456 });
  assertEquals(blocklist.pubkeys.has(123 as never), true);
  assertEquals(blocklist.ips.has(456 as never), true);
});

Deno.test('legacy bearer blocklist delete actions keep empty path semantics', () => {
  const blocklist = { pubkeys: new Set<string>(), ips: new Set<string>() };

  const pubkey = deleteLegacyBearerPubkey(blocklist, '');
  const ip = deleteLegacyBearerIp(blocklist, '');

  assertEquals(pubkey, { deleted: '' });
  assertEquals(ip, { deleted: '' });
});
