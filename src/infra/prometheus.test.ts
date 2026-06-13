import { assertEquals } from '@std/assert';
import { createPrometheusMetrics } from './prometheus.ts';

Deno.test('prometheus counter increments and renders', () => {
  const m = createPrometheusMetrics();
  m.counter('pfortner_connections_total');
  m.counter('pfortner_connections_total');
  const output = m.render();
  assertEquals(output.includes('pfortner_connections_total 2'), true);
});

Deno.test('prometheus counter with labels', () => {
  const m = createPrometheusMetrics();
  m.counter('pfortner_messages_total', { direction: 'client', type: 'EVENT' });
  m.counter('pfortner_messages_total', { direction: 'client', type: 'EVENT' });
  m.counter('pfortner_messages_total', { direction: 'server', type: 'EVENT' });
  const output = m.render();
  assertEquals(output.includes('pfortner_messages_total{direction="client",type="EVENT"} 2'), true);
  assertEquals(output.includes('pfortner_messages_total{direction="server",type="EVENT"} 1'), true);
});

Deno.test('prometheus gauge sets value', () => {
  const m = createPrometheusMetrics();
  m.gauge('pfortner_connections_active', 5);
  m.gauge('pfortner_connections_active', 3);
  const output = m.render();
  assertEquals(output.includes('pfortner_connections_active 3'), true);
});

Deno.test('prometheus histogram records values', () => {
  const m = createPrometheusMetrics();
  m.histogram('pfortner_policy_duration_seconds', 0.01, { policy: 'rate-limit' });
  m.histogram('pfortner_policy_duration_seconds', 0.05, { policy: 'rate-limit' });
  const output = m.render();
  assertEquals(output.includes('pfortner_policy_duration_seconds_count{policy="rate-limit"} 2'), true);
  assertEquals(output.includes('pfortner_policy_duration_seconds_sum{policy="rate-limit"}'), true);
});
