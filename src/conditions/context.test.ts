// src/conditions/context.test.ts
import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { buildEvalContext } from './context.ts';

const connInfo = { clientAuthorized: true, clientPubkey: 'pk1', connectionIpAddr: '1.2.3.4', connectionId: 'c1' };

Deno.test('buildEvalContext extracts connection info', () => {
  const ctx = buildEvalContext(['REQ', 'sub1', {}], connInfo);
  assertEquals(ctx.authenticated, true);
  assertEquals(ctx.pubkey, 'pk1');
  assertEquals(ctx.clientIp, '1.2.3.4');
  assertEquals(ctx.messageType, 'REQ');
});

Deno.test('buildEvalContext extracts event info from client EVENT', () => {
  const ctx = buildEvalContext(['EVENT', { kind: 4, pubkey: 'author1' }], connInfo);
  assertEquals(ctx.eventKind, 4);
  assertEquals(ctx.eventPubkey, 'author1');
});

Deno.test('buildEvalContext extracts event info from server EVENT', () => {
  const ctx = buildEvalContext(['EVENT', 'sub1', { kind: 1, pubkey: 'author2' }], connInfo);
  assertEquals(ctx.eventKind, 1);
  assertEquals(ctx.eventPubkey, 'author2');
});

Deno.test('buildEvalContext sets null for non-EVENT messages', () => {
  const ctx = buildEvalContext(['REQ', 'sub1', {}], connInfo);
  assertEquals(ctx.eventKind, null);
  assertEquals(ctx.eventPubkey, null);
});

Deno.test('buildEvalContext detects has_search in REQ filters', () => {
  const ctx = buildEvalContext(['REQ', 'sub1', { kinds: [1], search: 'hello' }], connInfo);
  assertEquals(ctx.hasSearch, true);
});

Deno.test('buildEvalContext hasSearch false for REQ without search', () => {
  const ctx = buildEvalContext(['REQ', 'sub1', { kinds: [1] }], connInfo);
  assertEquals(ctx.hasSearch, false);
});

Deno.test('buildEvalContext hasSearch false for non-REQ', () => {
  const ctx = buildEvalContext(['EVENT', { kind: 1, pubkey: 'pk' }], connInfo);
  assertEquals(ctx.hasSearch, false);
});
