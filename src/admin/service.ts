import type { PfortnerConfig } from '../config/loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { ThroughputTracker } from '../infra/throughput-tracker.ts';

export interface AdminServiceState {
  config: PfortnerConfig;
  pluginNames: string[];
  connections: Map<string, ManagedConnection>;
  blacklist: { pubkeys: Set<string>; ips: Set<string> };
  configPath?: string;
  reloadFn?: (yamlString: string) => Promise<void>;
  shutdownManager?: { isDraining(): boolean; initiateShutdown(): Promise<void> };
  connectionManager?: { getStats(): any };
  upstreamProbe?: { getLatency(): number | null; getStatus(): string };
  startTime?: number;
  throughputTracker?: ThroughputTracker;
}

export function maskSecrets(config: PfortnerConfig): unknown {
  const masked = JSON.parse(JSON.stringify(config));
  if (masked.admin?.auth_token) masked.admin.auth_token = '***';
  if (masked.infra?.redis?.url) masked.infra.redis.url = '***';
  return masked;
}

export function getHealthSimple(state: AdminServiceState): { status: string; connections: number } {
  const status = state.shutdownManager?.isDraining() ? 'draining' : 'ok';
  return { status, connections: state.connections.size };
}

export function getHealthDetail(state: AdminServiceState): Record<string, unknown> {
  const uptime = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
  const connStats = state.connectionManager?.getStats();
  let memory: Record<string, number> | null = null;
  try {
    const mem = Deno.memoryUsage();
    memory = { rss_mb: Math.round(mem.rss / 1024 / 1024), heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024) };
  } catch { /* ignore */ }

  return {
    status: state.shutdownManager?.isDraining() ? 'draining' : 'ok',
    uptime_seconds: uptime,
    connections: connStats ?? { active: state.connections.size },
    upstream: {
      latency_ms: state.upstreamProbe?.getLatency() ?? null,
      status: state.upstreamProbe?.getStatus() ?? 'unknown',
    },
    memory,
    shutdown: { draining: state.shutdownManager?.isDraining() ?? false },
  };
}

export function getConnections(state: AdminServiceState): unknown[] {
  return [...state.connections.values()].map((m) => m.info);
}

export function closeConnection(state: AdminServiceState, id: string): { found: boolean } {
  const managed = state.connections.get(id);
  if (managed) {
    managed.close();
    return { found: true };
  }
  return { found: false };
}

export function closeConnectionBatch(
  state: AdminServiceState,
  ids: string[],
): { closed: string[]; notFound: string[] } {
  const closed: string[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    const managed = state.connections.get(id);
    if (managed) {
      managed.close();
      closed.push(id);
    } else {
      notFound.push(id);
    }
  }
  return { closed, notFound };
}

export function getThroughputData(state: AdminServiceState): unknown {
  return state.throughputTracker?.getData() ?? [];
}
