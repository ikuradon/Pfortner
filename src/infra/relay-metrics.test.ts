import { assertEquals } from '@std/assert';
import type { ConnectionInfo } from '../pfortner.ts';
import type { PfortnerInstance } from '../plugins/types.ts';
import { createPrometheusMetrics } from './prometheus.ts';
import { ThroughputTracker } from './throughput-tracker.ts';
import {
  instrumentPolicyFactory,
  recordPipelineResult,
  recordRawMessageMetric,
  registerRelayMessageMetrics,
} from './relay-metrics.ts';

function makeConnectionInfo(): ConnectionInfo {
  return {
    connectionId: 'conn-1',
    connectionIpAddr: '127.0.0.1',
    clientAuthorized: false,
    clientPubkey: '',
  };
}

function makeInstance(): PfortnerInstance {
  return {
    sendAuthMessage: () => {},
    sendMessageToClient: () => Promise.resolve(),
    connectionInfo: makeConnectionInfo(),
  };
}

Deno.test('instrumentPolicyFactory records decisions and duration labels', async () => {
  const metrics = createPrometheusMetrics();
  const factory = instrumentPolicyFactory(
    () => () => ({ message: ['EVENT', {}], action: 'accept' }),
    { direction: 'client', policy: 'accept', metrics },
  );
  const policy = factory(makeInstance());

  await policy(['EVENT', {}], makeConnectionInfo());

  const output = metrics.render();
  assertEquals(
    output.includes('pfortner_policy_decisions_total{direction="client",policy="accept",action="accept"} 1'),
    true,
  );
  assertEquals(
    output.includes('pfortner_policy_duration_seconds_count{direction="client",policy="accept"} 1'),
    true,
  );
});

Deno.test('recordRawMessageMetric records Nostr message type labels', () => {
  const metrics = createPrometheusMetrics();

  recordRawMessageMetric(metrics, 'client', '["EVENT",{"id":"e1"}]');
  recordRawMessageMetric(metrics, 'server', '["OK","e1",true,""]');
  recordRawMessageMetric(metrics, 'server', 'not-json');

  const output = metrics.render();
  assertEquals(output.includes('pfortner_messages_total{direction="client",type="EVENT"} 1'), true);
  assertEquals(output.includes('pfortner_messages_total{direction="server",type="OK"} 1'), true);
  assertEquals(output.includes('pfortner_messages_total{direction="server",type="unknown"} 1'), true);
});

Deno.test('registerRelayMessageMetrics attaches client and server message listeners', () => {
  const metrics = createPrometheusMetrics();
  const listeners = new Map<string, (message: string) => void>();
  const source = {
    on: (event: 'clientMsg' | 'serverMsg', handler: (message: string) => void) => {
      listeners.set(event, handler);
    },
  };

  registerRelayMessageMetrics(source, metrics);
  listeners.get('clientMsg')?.('["REQ","sub1",{}]');
  listeners.get('serverMsg')?.('["EOSE","sub1"]');

  const output = metrics.render();
  assertEquals(output.includes('pfortner_messages_total{direction="client",type="REQ"} 1'), true);
  assertEquals(output.includes('pfortner_messages_total{direction="server",type="EOSE"} 1'), true);
});

Deno.test('recordPipelineResult updates throughput only for final accept and reject', () => {
  const tracker = new ThroughputTracker(3, 1000);

  recordPipelineResult(tracker, 'accept');
  recordPipelineResult(tracker, 'reject');

  const totals = tracker.getTotals();
  assertEquals(totals.totalAccept, 1);
  assertEquals(totals.totalReject, 1);
});
