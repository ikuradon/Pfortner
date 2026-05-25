export const BUILTIN_PLUGIN_NAMES = [
  'accept',
  'kind-filter',
  'write-guard',
  'protected-event',
  'rate-limit',
  'spam-filter',
  'content-filter',
  'pubkey-acl',
  'ip-filter',
  'when',
  'match',
  'route',
] as const;

export const BUILTIN_PLUGIN_NAME_SET = new Set<string>(BUILTIN_PLUGIN_NAMES);
