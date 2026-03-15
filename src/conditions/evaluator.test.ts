import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { evaluateCondition } from './evaluator.ts';
import type { EvalContext } from './types.ts';

const baseCtx: EvalContext = {
  authenticated: true,
  pubkey: 'pk1',
  clientIp: '1.2.3.4',
  messageType: 'EVENT',
  eventKind: 1,
  eventPubkey: 'author1',
  hasSearch: false,
};

Deno.test('simple condition: authenticated matches', () => {
  assertEquals(evaluateCondition({ authenticated: true }, baseCtx), true);
  assertEquals(evaluateCondition({ authenticated: false }, baseCtx), false);
});

Deno.test('simple condition: pubkey matches', () => {
  assertEquals(evaluateCondition({ pubkey: 'pk1' }, baseCtx), true);
  assertEquals(evaluateCondition({ pubkey: 'other' }, baseCtx), false);
});

Deno.test('simple condition: client_ip matches', () => {
  assertEquals(evaluateCondition({ client_ip: '1.2.3.4' }, baseCtx), true);
  assertEquals(evaluateCondition({ client_ip: '5.6.7.8' }, baseCtx), false);
});

Deno.test('simple condition: message_type matches', () => {
  assertEquals(evaluateCondition({ message_type: 'EVENT' }, baseCtx), true);
  assertEquals(evaluateCondition({ message_type: 'REQ' }, baseCtx), false);
});

Deno.test('simple condition: event_kind matches', () => {
  assertEquals(evaluateCondition({ event_kind: 1 }, baseCtx), true);
  assertEquals(evaluateCondition({ event_kind: 4 }, baseCtx), false);
});

Deno.test('simple condition: event_kind null context returns false', () => {
  assertEquals(evaluateCondition({ event_kind: 1 }, { ...baseCtx, eventKind: null }), false);
});

Deno.test('simple condition: multiple fields are implicit AND', () => {
  assertEquals(evaluateCondition({ authenticated: true, message_type: 'EVENT' }, baseCtx), true);
  assertEquals(evaluateCondition({ authenticated: true, message_type: 'REQ' }, baseCtx), false);
});

Deno.test('simple condition: empty object matches everything', () => {
  assertEquals(evaluateCondition({}, baseCtx), true);
});

Deno.test('and: all must be true', () => {
  assertEquals(evaluateCondition({ and: [{ authenticated: true }, { event_kind: 1 }] }, baseCtx), true);
  assertEquals(evaluateCondition({ and: [{ authenticated: true }, { event_kind: 4 }] }, baseCtx), false);
});

Deno.test('or: at least one must be true', () => {
  assertEquals(evaluateCondition({ or: [{ event_kind: 4 }, { event_kind: 1 }] }, baseCtx), true);
  assertEquals(evaluateCondition({ or: [{ event_kind: 4 }, { event_kind: 30023 }] }, baseCtx), false);
});

Deno.test('not: negates condition', () => {
  assertEquals(evaluateCondition({ not: { authenticated: true } }, baseCtx), false);
  assertEquals(evaluateCondition({ not: { authenticated: false } }, baseCtx), true);
});

Deno.test('nested: and with not', () => {
  assertEquals(
    evaluateCondition({
      and: [{ authenticated: true }, { not: { event_kind: 4 } }],
    }, baseCtx),
    true,
  );
});

Deno.test('nested: or with and', () => {
  assertEquals(
    evaluateCondition({
      or: [
        { and: [{ authenticated: false }, { event_kind: 1 }] },
        { and: [{ authenticated: true }, { event_kind: 1 }] },
      ],
    }, baseCtx),
    true,
  );
});

Deno.test('precedence: and key takes priority over simple fields', () => {
  // { and: [...], pubkey: "x" } — and takes precedence, pubkey ignored
  assertEquals(
    evaluateCondition(
      { and: [{ authenticated: true }], pubkey: 'wrong' } as any,
      baseCtx,
    ),
    true,
  );
});

Deno.test('simple condition: has_search matches', () => {
  assertEquals(evaluateCondition({ has_search: true }, { ...baseCtx, hasSearch: true }), true);
  assertEquals(evaluateCondition({ has_search: true }, { ...baseCtx, hasSearch: false }), false);
});

Deno.test('and: empty array returns true', () => {
  // Array.every on empty array = true
  assertEquals(evaluateCondition({ and: [] } as any, baseCtx), true);
});

Deno.test('or: empty array returns false', () => {
  // Array.some on empty array = false
  assertEquals(evaluateCondition({ or: [] } as any, baseCtx), false);
});

Deno.test('simple condition: event_pubkey when context eventPubkey is null returns false', () => {
  assertEquals(evaluateCondition({ event_pubkey: 'author1' }, { ...baseCtx, eventPubkey: null }), false);
});
