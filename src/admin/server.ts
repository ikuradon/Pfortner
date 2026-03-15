import type { PfortnerConfig } from '../config/loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { ConnectionManager } from '../connections/manager.ts';
import type { ShutdownManager } from '../shutdown/manager.ts';
import type { UpstreamProbe } from '../connections/upstream-probe.ts';

export interface AdminState {
  config: PfortnerConfig;
  pluginNames: string[];
  connections: Map<string, ManagedConnection>;
  blacklist: { pubkeys: Set<string>; ips: Set<string> };
  configPath?: string;
  reloadFn?: (yamlString: string) => Promise<void>;
  shutdownManager?: ShutdownManager;
  connectionManager?: ConnectionManager;
  upstreamProbe?: UpstreamProbe;
  startTime?: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function maskSecrets(config: PfortnerConfig): unknown {
  const masked = JSON.parse(JSON.stringify(config));
  if (masked.admin?.auth_token) masked.admin.auth_token = '***';
  if (masked.infra?.redis?.url) masked.infra.redis.url = '***';
  return masked;
}

export function createAdminHandler(state: AdminState): (req: Request) => Promise<Response> {
  const authToken = state.config.admin?.auth_token;

  return async (req: Request): Promise<Response> => {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token || token !== authToken) {
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // GET /health
    if (method === 'GET' && path === '/health') {
      const stats = state.connectionManager?.getStats();
      return json({
        status: 'ok',
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
        status: 'ok',
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
      return json({ connections: [...state.connections.values()].map((m) => m.info) });
    }

    // DELETE /connections/:id
    if (method === 'DELETE' && path.startsWith('/connections/')) {
      const id = path.slice('/connections/'.length);
      const managed = state.connections.get(id);
      if (managed) {
        managed.close();
        return json({ closing: id });
      }
      return json({ error: 'connection not found' }, 404);
    }

    // POST /blacklist/pubkey
    if (method === 'POST' && path === '/blacklist/pubkey') {
      const body = await req.json();
      if (body.pubkey) {
        state.blacklist.pubkeys.add(body.pubkey);
        return json({ added: body.pubkey });
      }
      return json({ error: 'pubkey required' }, 400);
    }

    // DELETE /blacklist/pubkey/:pk
    if (method === 'DELETE' && path.startsWith('/blacklist/pubkey/')) {
      const pk = path.slice('/blacklist/pubkey/'.length);
      state.blacklist.pubkeys.delete(pk);
      return json({ deleted: pk });
    }

    // POST /blacklist/ip
    if (method === 'POST' && path === '/blacklist/ip') {
      const body = await req.json();
      if (body.ip) {
        state.blacklist.ips.add(body.ip);
        return json({ added: body.ip });
      }
      return json({ error: 'ip required' }, 400);
    }

    // DELETE /blacklist/ip/:ip
    if (method === 'DELETE' && path.startsWith('/blacklist/ip/')) {
      const ip = path.slice('/blacklist/ip/'.length);
      state.blacklist.ips.delete(ip);
      return json({ deleted: ip });
    }

    // POST /reload
    if (method === 'POST' && path === '/reload') {
      if (!state.configPath || !state.reloadFn) {
        return json({ error: 'reload not configured' }, 500);
      }
      try {
        const content = await Deno.readTextFile(state.configPath);
        await state.reloadFn(content);
        return json({ status: 'reloaded' });
      } catch (e) {
        return json({ error: `reload failed: ${(e as Error).message}` }, 500);
      }
    }

    // POST /shutdown
    if (method === 'POST' && path === '/shutdown') {
      if (state.shutdownManager) {
        state.shutdownManager.initiateShutdown().catch(console.error);
        return json({ status: 'shutting down' });
      }
      return json({ error: 'shutdown not configured' }, 500);
    }

    return json({ error: 'not found' }, 404);
  };
}
