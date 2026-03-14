import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createInMemoryMetrics, createNoopMetrics } from './metrics.ts';

Deno.test('noop metrics does not throw', () => {
  const m = createNoopMetrics();
  m.counter('test_total');
  m.gauge('test_active', 5);
  m.histogram('test_duration', 0.123);
});

Deno.test('in-memory metrics records values', () => {
  const m = createInMemoryMetrics();
  m.counter('requests_total', { method: 'GET' });
  m.counter('requests_total', { method: 'GET' });
  m.gauge('connections', 5);
  m.histogram('duration', 0.1);
  assertEquals(m.getCounter('requests_total'), 2);
  assertEquals(m.getGauge('connections'), 5);
  assertEquals(m.getHistogramCount('duration'), 1);
});
