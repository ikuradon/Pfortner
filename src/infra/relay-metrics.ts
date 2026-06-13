import type { MetricsCollector, PolicyFactory } from '../plugins/types.ts';
import type { OutputMessage } from '../pfortner.ts';
import { ThroughputTracker } from './throughput-tracker.ts';

export type RelayMetricDirection = 'client' | 'server';
export type RelayPolicyAction = OutputMessage['action'];
type RelayMessageMetricSource = {
  on(event: 'clientMsg' | 'serverMsg', handler: (message: string) => void): void;
};

export function instrumentPolicyFactory(
  factory: PolicyFactory,
  options: {
    direction: RelayMetricDirection;
    policy: string;
    metrics: MetricsCollector;
  },
): PolicyFactory {
  return (instance) => {
    const policy = factory(instance);
    return async (message, connectionInfo, policyOptions) => {
      const startedAt = performance.now();
      const result = await policy(message, connectionInfo, policyOptions);
      const durationSeconds = Math.max((performance.now() - startedAt) / 1000, 0);
      try {
        options.metrics.counter('pfortner_policy_decisions_total', {
          direction: options.direction,
          policy: options.policy,
          action: result.action,
        });
        options.metrics.histogram('pfortner_policy_duration_seconds', durationSeconds, {
          direction: options.direction,
          policy: options.policy,
        });
      } catch {
        // Metrics must not affect relay behavior.
      }
      return result;
    };
  };
}

export function recordRawMessageMetric(
  metrics: MetricsCollector,
  direction: RelayMetricDirection,
  rawMessage: string,
): void {
  try {
    metrics.counter('pfortner_messages_total', {
      direction,
      type: parseMessageType(rawMessage),
    });
  } catch {
    // Metrics must not affect relay behavior.
  }
}

export function recordConnectionOpened(metrics: MetricsCollector, active: number): void {
  try {
    metrics.counter('pfortner_connections_total');
    metrics.gauge('pfortner_connections_active', active);
  } catch {
    // Metrics must not affect relay behavior.
  }
}

export function recordConnectionClosed(metrics: MetricsCollector, active: number): void {
  try {
    metrics.gauge('pfortner_connections_active', active);
  } catch {
    // Metrics must not affect relay behavior.
  }
}

export function recordPipelineResult(
  tracker: ThroughputTracker | undefined,
  action: 'accept' | 'reject',
): void {
  if (!tracker) return;
  if (action === 'accept') tracker.recordAccept();
  else tracker.recordReject();
}

export function registerRelayMessageMetrics(
  source: RelayMessageMetricSource,
  metrics: MetricsCollector,
): void {
  source.on('clientMsg', (message) => recordRawMessageMetric(metrics, 'client', message));
  source.on('serverMsg', (message) => recordRawMessageMetric(metrics, 'server', message));
}

function parseMessageType(rawMessage: string): string {
  try {
    const parsed = JSON.parse(rawMessage);
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || parsed[0].length === 0) {
      return 'unknown';
    }
    return parsed[0];
  } catch {
    return 'unknown';
  }
}
