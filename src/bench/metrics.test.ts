import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { MetricsCollector } from './metrics.ts';

Deno.test('MetricsCollector records and calculates percentiles', () => {
  const mc = new MetricsCollector();
  for (let i = 1; i <= 100; i++) mc.recordEventLatency(i);
  const stats = mc.getStats();
  assertEquals(stats.events.sent, 0); // latency != sent count
  assertEquals(stats.event_latency.p50, 50);
  assertEquals(stats.event_latency.p99, 99);
});

Deno.test('MetricsCollector counts events', () => {
  const mc = new MetricsCollector();
  mc.recordEvent('sent');
  mc.recordEvent('sent');
  mc.recordEvent('ok');
  mc.recordEvent('rejected');
  const stats = mc.getStats();
  assertEquals(stats.events.sent, 2);
  assertEquals(stats.events.ok, 1);
  assertEquals(stats.events.rejected, 1);
});

Deno.test('MetricsCollector counts auth', () => {
  const mc = new MetricsCollector();
  mc.recordAuthChallenge();
  mc.recordAuthChallenge();
  mc.recordAuthResponse();
  mc.recordAuthLatency(10);
  const stats = mc.getStats();
  assertEquals(stats.auth.challenges, 2);
  assertEquals(stats.auth.responses, 1);
});

Deno.test('MetricsCollector counts errors', () => {
  const mc = new MetricsCollector();
  mc.recordError('ws_error');
  mc.recordError('timeout');
  mc.recordError('backpressure');
  const stats = mc.getStats();
  assertEquals(stats.errors.ws_errors, 1);
  assertEquals(stats.errors.timeouts, 1);
  assertEquals(stats.errors.backpressure_skips, 1);
});

Deno.test('MetricsCollector connection stats', () => {
  const mc = new MetricsCollector();
  mc.recordConnectionEstablished();
  mc.recordConnectionEstablished();
  mc.recordConnectionFailed();
  mc.recordConnectionLatency(5);
  mc.recordConnectionLatency(15);
  mc.updateMaxConcurrent(10);
  const stats = mc.getStats();
  assertEquals(stats.connections.established, 2);
  assertEquals(stats.connections.failed, 1);
  assertEquals(stats.connections.max_concurrent, 10);
});

Deno.test('MetricsCollector reservoir sampling bounds memory', () => {
  const mc = new MetricsCollector(100); // small reservoir for testing
  for (let i = 0; i < 1000; i++) mc.recordEventLatency(i);
  // Should not throw, stats should work
  const stats = mc.getStats();
  assertEquals(typeof stats.event_latency.p50, 'number');
});
