import type { PfortnerConfig } from '../config/loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { ConnectionManager } from '../connections/manager.ts';
import type { LogBuffer } from '../infra/log-buffer.ts';
import type { ShutdownManager } from '../shutdown/manager.ts';
import type { UpstreamProbe } from '../connections/upstream-probe.ts';
import type { ThroughputTracker } from '../infra/throughput-tracker.ts';
import type { PrometheusMetrics } from '../infra/prometheus.ts';
import { closeConnection, closeConnectionBatch } from './actions/connections.ts';
import {
  addLegacyBearerIp,
  addLegacyBearerPubkey,
  deleteLegacyBearerIp,
  deleteLegacyBearerPubkey,
} from './actions/blocklist.ts';
import { reloadConfig } from './actions/reload.ts';
import { shutdownAdmin } from './actions/shutdown.ts';
import { maskSecrets } from './read_models/config_view.ts';
import { getConnections } from './read_models/connections.ts';
import { getHealthDetail, getHealthSimple } from './read_models/health.ts';
import { getLogs, parseLogLimit } from './read_models/logs.ts';
import { getThroughputData } from './read_models/throughput.ts';
import { createLogStreamResponse } from './http/log_stream.ts';
import { type AdminServiceState } from './state.ts';

export interface AdminState extends AdminServiceState {
  config: PfortnerConfig;
  pluginNames: string[];
  connections: Map<string, ManagedConnection>;
  blocklist: { pubkeys: Set<string>; ips: Set<string> };
  configPath?: string;
  reloadFn?: (yamlString: string) => Promise<void>;
  shutdownManager?: ShutdownManager;
  connectionManager?: ConnectionManager;
  upstreamProbe?: UpstreamProbe;
  startTime?: number;
  throughputTracker?: ThroughputTracker;
  metrics?: PrometheusMetrics;
  logBuffer?: LogBuffer;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createAdminHandler(state: AdminState): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token || token !== state.config.admin?.auth_token) {
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // GET /health
    if (method === 'GET' && path === '/health') {
      const health = getHealthSimple(state);
      const stats = state.connectionManager?.getStats();
      return json({
        status: health.status,
        connections: stats?.active ?? state.connections.size,
        pressure: stats?.pressure ?? 'normal',
      });
    }

    // GET /health/detail
    if (method === 'GET' && path === '/health/detail') {
      const stats = state.connectionManager?.getStats() ?? {
        active: state.connections.size,
        authenticated: 0,
        max: 0,
        perIpMax: 0,
        pressure: 'normal' as const,
      };
      const uptime = state.startTime != null ? Math.floor((Date.now() - state.startTime) / 1000) : null;
      return json({
        status: getHealthDetail(state).status,
        uptime_seconds: uptime,
        connections: stats,
        upstream: {
          status: state.upstreamProbe?.getStatus() ?? 'unknown',
          latency_ms: state.upstreamProbe?.getLatency() ?? null,
        },
        memory: Deno.memoryUsage(),
      });
    }

    // GET /config
    if (method === 'GET' && path === '/config') {
      return json(maskSecrets(state.config));
    }

    // GET /plugins
    if (method === 'GET' && path === '/plugins') {
      return json({ plugins: state.pluginNames });
    }

    // GET /connections
    if (method === 'GET' && path === '/connections') {
      return json({ connections: getConnections(state) });
    }

    // DELETE /connections/:id
    if (method === 'DELETE' && path.startsWith('/connections/')) {
      const id = path.slice('/connections/'.length);
      const result = closeConnection(state, id);
      if (result.found) {
        return json({ closing: id });
      }
      return json({ error: 'connection not found' }, 404);
    }

    // POST /connections/disconnect-batch
    if (method === 'POST' && path === '/connections/disconnect-batch') {
      const body = await req.json();
      if (Array.isArray(body.ids)) {
        const result = closeConnectionBatch(state, body.ids);
        return json(result);
      }
      return json({ error: 'ids array required' }, 400);
    }

    // GET /metrics/throughput
    if (method === 'GET' && path === '/metrics/throughput') {
      return json(getThroughputData(state));
    }

    // GET /logs
    if (method === 'GET' && path === '/logs') {
      return json(getLogs(state, parseLogLimit(url.searchParams.get('limit'))));
    }

    // GET /logs/stream
    if (method === 'GET' && path === '/logs/stream') {
      return createLogStreamResponse(state, {
        signal: req.signal,
        replay: parseLogLimit(url.searchParams.get('replay'), 100),
      });
    }

    // POST /blocklist/pubkey
    if (method === 'POST' && path === '/blocklist/pubkey') {
      const body = await req.json();
      const result = addLegacyBearerPubkey(state.blocklist, body.pubkey);
      return 'error' in result ? json({ error: result.error }, 400) : json(result);
    }

    // DELETE /blocklist/pubkey/:pk
    if (method === 'DELETE' && path.startsWith('/blocklist/pubkey/')) {
      const pk = path.slice('/blocklist/pubkey/'.length);
      const result = deleteLegacyBearerPubkey(state.blocklist, pk);
      return 'error' in result ? json({ error: result.error }, 400) : json(result);
    }

    // POST /blocklist/ip
    if (method === 'POST' && path === '/blocklist/ip') {
      const body = await req.json();
      const result = addLegacyBearerIp(state.blocklist, body.ip);
      return 'error' in result ? json({ error: result.error }, 400) : json(result);
    }

    // DELETE /blocklist/ip/:ip
    if (method === 'DELETE' && path.startsWith('/blocklist/ip/')) {
      const ip = path.slice('/blocklist/ip/'.length);
      const result = deleteLegacyBearerIp(state.blocklist, ip);
      return 'error' in result ? json({ error: result.error }, 400) : json(result);
    }

    // POST /reload
    if (method === 'POST' && path === '/reload') {
      const result = await reloadConfig(state);
      return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }

    // POST /shutdown
    if (method === 'POST' && path === '/shutdown') {
      const result = shutdownAdmin(state);
      return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }

    return json({ error: 'not found' }, 404);
  };
}
