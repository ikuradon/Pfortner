export type RuntimeBlocklist = { pubkeys: Set<string>; ips: Set<string> };

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
