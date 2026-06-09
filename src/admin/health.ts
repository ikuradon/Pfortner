import type { AdminServiceState } from './state.ts';

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
    memory = { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal };
  } catch {
    // Deno.memoryUsage() が使えない環境では memory を null のまま返す。
  }

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
