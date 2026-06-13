import { getHealthDetail } from '$admin/service.ts';
import type { AdminState } from '$admin/server.ts';
import type { DashboardPage } from '../routes/index.tsx';

export type DashboardHealth = Parameters<typeof DashboardPage>[0]['health'];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function buildDashboardHealth(state: AdminState): DashboardHealth {
  const detail = getHealthDetail(state);
  const connections = asRecord(detail.connections);
  const upstream = asRecord(detail.upstream);
  const memory = asRecord(detail.memory);

  return {
    status: stringOr(detail.status, 'ok'),
    connections: {
      active: numberOr(connections.active, state.connections.size),
      max: numberOr(connections.max, 0),
      pressure: stringOr(connections.pressure, 'normal'),
    },
    upstream: {
      status: stringOr(upstream.status, 'unknown'),
      latency_ms: nullableNumber(upstream.latency_ms),
    },
    uptime_seconds: nullableNumber(detail.uptime_seconds),
    memory: detail.memory === null ? null : {
      rss: numberOr(memory.rss, 0),
      heapUsed: numberOr(memory.heapUsed, 0),
    },
  };
}
