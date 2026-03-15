import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { formatJsonReport, formatMarkdownReport } from './reporter.ts';
import type { ScenarioStats } from './metrics.ts';

const mockStats: ScenarioStats = {
  connections: { established: 10, failed: 0, max_concurrent: 10, latency_ms: { p50: 2, p95: 8, p99: 15 } },
  events: { sent: 100, ok: 95, rejected: 5, latency_ms: { p50: 3, p95: 10, p99: 18 } },
  requests: { sent: 0, eose: 0, latency_ms: { p50: null, p95: null, p99: null } },
  auth: { challenges: 0, responses: 0, latency_ms: { p50: null, p95: null, p99: null } },
  errors: { ws_errors: 0, timeouts: 0, backpressure_skips: 0 },
  event_latency: { p50: 3, p95: 10, p99: 18 },
};

Deno.test('formatJsonReport produces valid JSON', () => {
  const result = formatJsonReport('ws://localhost:3000', [{ name: 'test', duration: 10, stats: mockStats }]);
  const parsed = JSON.parse(result);
  assertEquals(parsed.version, 1);
  assertEquals(parsed.target, 'ws://localhost:3000');
  assertEquals(parsed.scenarios.length, 1);
  assertEquals(parsed.scenarios[0].name, 'test');
  assertEquals(parsed.scenarios[0].events.sent, 100);
});

Deno.test('formatMarkdownReport produces markdown', () => {
  const result = formatMarkdownReport('ws://localhost:3000', [{ name: 'test', duration: 10, stats: mockStats }]);
  assertEquals(result.includes('# Bench Report'), true);
  assertEquals(result.includes('test'), true);
  assertEquals(result.includes('100 sent'), true);
});
