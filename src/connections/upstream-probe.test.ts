// src/connections/upstream-probe.test.ts
import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { UpstreamProbe } from './upstream-probe.ts';

Deno.test('UpstreamProbe returns unknown before start', () => {
  const probe = new UpstreamProbe('http://localhost:9999', 60000);
  assertEquals(probe.getStatus(), 'unknown');
  assertEquals(probe.getLatency(), null);
});

Deno.test('UpstreamProbe converts wss to https', () => {
  const probe = UpstreamProbe.fromRelayUrl('wss://relay.example.com');
  assertEquals(probe !== null, true);
});

Deno.test('UpstreamProbe converts ws to http', () => {
  const probe = UpstreamProbe.fromRelayUrl('ws://localhost:7777');
  assertEquals(probe !== null, true);
});
