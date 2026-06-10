export const POLICY_ICONS = {
  start: '▶',
  accept: '✓',
  'kind-filter': '#',
  'write-guard': '✎',
  'protected-event': '⛨',
  'rate-limit': '⏱',
  'spam-filter': '!',
  'content-filter': 'T',
  'pubkey-acl': '⌘',
  'ip-filter': 'IP',
  when: '?',
  match: '=',
  route: '↗',
} as const;

export function policyIcon(policy: string | null | undefined): string {
  const normalized = policy?.trim() ?? '';
  if (!normalized) return '?';
  return POLICY_ICONS[normalized as keyof typeof POLICY_ICONS] ??
    normalized.charAt(0).toUpperCase();
}
