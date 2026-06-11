import { assertEquals } from '@std/assert';
import { POLICY_ICONS, policyIcon } from './policy_icons.ts';

Deno.test('policy icons provide semantic glyphs for builtin policies', () => {
  assertEquals(policyIcon('accept'), '✓');
  assertEquals(policyIcon('kind-filter'), '⊞');
  assertEquals(policyIcon('write-guard'), '✎');
  assertEquals(policyIcon('protected-event'), '🔒');
  assertEquals(policyIcon('rate-limit'), '⏱');
  assertEquals(policyIcon('spam-filter'), '🚫');
  assertEquals(policyIcon('content-filter'), '⊟');
  assertEquals(policyIcon('pubkey-acl'), '👤');
  assertEquals(policyIcon('ip-filter'), '🌐');
  assertEquals(policyIcon('when'), '?');
  assertEquals(policyIcon('match'), '≡');
  assertEquals(policyIcon('route'), '→');
  assertEquals(policyIcon('start'), '▶');
  assertEquals(Object.keys(POLICY_ICONS).length, 13);
});

Deno.test('policy icon falls back predictably for external plugins', () => {
  assertEquals(policyIcon('external-policy'), '⚙');
  assertEquals(policyIcon(''), '⚙');
});
