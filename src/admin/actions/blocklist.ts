export type RuntimeBlocklist = { pubkeys: Set<string>; ips: Set<string> };
type LegacyAddedResult = { added: unknown } | { error: string };
type DeleteResult = { deleted: string } | { error: string };

export function listBlocklist(blocklist: RuntimeBlocklist): { pubkeys: string[]; ips: string[] } {
  return { pubkeys: [...blocklist.pubkeys], ips: [...blocklist.ips] };
}

export function addPubkey(blocklist: RuntimeBlocklist, pubkey: unknown): { added: string } | { error: string } {
  if (typeof pubkey === 'string' && pubkey.length > 0) {
    blocklist.pubkeys.add(pubkey);
    return { added: pubkey };
  }
  return { error: 'pubkey required' };
}

export function deletePubkey(blocklist: RuntimeBlocklist, pubkey: string): { deleted: string } | { error: string } {
  if (pubkey) {
    blocklist.pubkeys.delete(pubkey);
    return { deleted: pubkey };
  }
  return { error: 'pubkey required' };
}

export function addLegacyBearerPubkey(blocklist: RuntimeBlocklist, pubkey: unknown): LegacyAddedResult {
  if (pubkey) {
    (blocklist.pubkeys as Set<unknown>).add(pubkey);
    return { added: pubkey };
  }
  return addPubkey(blocklist, pubkey);
}

export function deleteLegacyBearerPubkey(blocklist: RuntimeBlocklist, pubkey: string): DeleteResult {
  if (pubkey === '') {
    blocklist.pubkeys.delete(pubkey);
    return { deleted: pubkey };
  }
  return deletePubkey(blocklist, pubkey);
}

export function addIp(blocklist: RuntimeBlocklist, ip: unknown): { added: string } | { error: string } {
  if (typeof ip === 'string' && ip.length > 0) {
    blocklist.ips.add(ip);
    return { added: ip };
  }
  return { error: 'ip required' };
}

export function deleteIp(blocklist: RuntimeBlocklist, ip: string): { deleted: string } | { error: string } {
  if (ip) {
    blocklist.ips.delete(ip);
    return { deleted: ip };
  }
  return { error: 'ip required' };
}

export function addLegacyBearerIp(blocklist: RuntimeBlocklist, ip: unknown): LegacyAddedResult {
  if (ip) {
    (blocklist.ips as Set<unknown>).add(ip);
    return { added: ip };
  }
  return addIp(blocklist, ip);
}

export function deleteLegacyBearerIp(blocklist: RuntimeBlocklist, ip: string): DeleteResult {
  if (ip === '') {
    blocklist.ips.delete(ip);
    return { deleted: ip };
  }
  return deleteIp(blocklist, ip);
}
