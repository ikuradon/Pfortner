import { json } from '$admin/server.ts';
import type { AdminState } from '$admin/server.ts';
import {
  closeConnectionBatch,
  createLogStreamResponse,
  getConnections,
  getHealthDetail,
  getHealthSimple,
  getLogs,
  getThroughputData,
  maskSecrets,
  parseLogLimit,
  simulatePipeline,
} from '$admin/service.ts';
import type { AdminRouteApp } from './route_types.ts';

export function registerAdminApiRoutes(
  app: AdminRouteApp,
  adminPath: string,
  state: AdminState,
): void {
  app.get(`${adminPath}/api/health`, (_ctx) => {
    return json(getHealthSimple(state));
  });

  app.get(`${adminPath}/api/health/detail`, (_ctx) => {
    return json(getHealthDetail(state));
  });

  app.get(`${adminPath}/api/connections`, (_ctx) => {
    return json({ connections: getConnections(state) });
  });

  app.post(`${adminPath}/api/connections/disconnect-batch`, async (ctx) => {
    const body = await ctx.req.json();
    if (Array.isArray(body.ids)) {
      return json(closeConnectionBatch(state, body.ids));
    }
    return json({ error: 'ids array required' }, 400);
  });

  app.get(`${adminPath}/api/metrics/throughput`, (_ctx) => {
    return json(getThroughputData(state));
  });

  app.get(`${adminPath}/api/metrics/prometheus`, (_ctx) => {
    if (!state.metrics) {
      return new Response('# Prometheus metrics not enabled\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(state.metrics.render(), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });

  app.get(`${adminPath}/api/logs`, (ctx) => {
    const url = new URL(ctx.req.url);
    return json(getLogs(state, parseLogLimit(url.searchParams.get('limit'))));
  });

  app.get(`${adminPath}/api/logs/stream`, (ctx) => {
    const url = new URL(ctx.req.url);
    return createLogStreamResponse(state, {
      signal: ctx.req.signal,
      replay: parseLogLimit(url.searchParams.get('replay'), 100),
    });
  });

  app.get(`${adminPath}/api/config`, (_ctx) => {
    return json(maskSecrets(state.config));
  });

  app.get(`${adminPath}/api/plugins`, (_ctx) => {
    return json({ plugins: state.pluginNames });
  });

  app.post(`${adminPath}/api/playground/evaluate`, async (ctx) => {
    try {
      const body = await ctx.req.json();
      const message = body.message;
      const direction = body.direction ?? 'client';
      const connectionInfo = {
        clientAuthorized: body.connectionInfo?.authenticated ?? false,
        clientPubkey: body.connectionInfo?.pubkey ?? '',
        connectionIpAddr: body.connectionInfo?.clientIp ?? '127.0.0.1',
      };
      if (!Array.isArray(message)) {
        return json({ error: 'message must be an array' }, 400);
      }
      const pipeline = direction === 'server'
        ? (state.config.pipelines?.server ?? [])
        : (state.config.pipelines?.client ?? []);
      const result = await simulatePipeline(pipeline, message, connectionInfo);
      return json(result);
    } catch (e) {
      return json({ error: `evaluation failed: ${(e as Error).message}` }, 500);
    }
  });

  app.get(`${adminPath}/api/blocklist`, (_ctx) => {
    return json({
      pubkeys: [...state.blocklist.pubkeys],
      ips: [...state.blocklist.ips],
    });
  });

  app.post(`${adminPath}/api/blocklist/pubkey`, async (ctx) => {
    const body = await ctx.req.json();
    if (typeof body.pubkey === 'string' && body.pubkey.length > 0) {
      state.blocklist.pubkeys.add(body.pubkey);
      return json({ added: body.pubkey });
    }
    return json({ error: 'pubkey required' }, 400);
  });

  app.delete(`${adminPath}/api/blocklist/pubkey/:pk`, (ctx) => {
    const pk = ctx.params.pk ?? '';
    if (pk) {
      state.blocklist.pubkeys.delete(pk);
      return json({ deleted: pk });
    }
    return json({ error: 'pubkey required' }, 400);
  });

  app.post(`${adminPath}/api/blocklist/ip`, async (ctx) => {
    const body = await ctx.req.json();
    if (typeof body.ip === 'string' && body.ip.length > 0) {
      state.blocklist.ips.add(body.ip);
      return json({ added: body.ip });
    }
    return json({ error: 'ip required' }, 400);
  });

  app.delete(`${adminPath}/api/blocklist/ip/:ip`, (ctx) => {
    const ip = ctx.params.ip ?? '';
    if (ip) {
      state.blocklist.ips.delete(ip);
      return json({ deleted: ip });
    }
    return json({ error: 'ip required' }, 400);
  });

  app.post(`${adminPath}/api/reload`, async (_ctx) => {
    if (!state.configPath || !state.reloadFn) {
      return json({ error: 'reload not configured' }, 500);
    }
    try {
      const content = await Deno.readTextFile(state.configPath);
      await state.reloadFn(content);
      return new Response(null, {
        status: 302,
        headers: { Location: `${adminPath}/` },
      });
    } catch (e) {
      return json({ error: `reload failed: ${(e as Error).message}` }, 500);
    }
  });

  app.post(`${adminPath}/api/shutdown`, (_ctx) => {
    if (state.shutdownManager) {
      state.shutdownManager.initiateShutdown().catch(console.error);
      return new Response(null, {
        status: 302,
        headers: { Location: `${adminPath}/` },
      });
    }
    return json({ error: 'shutdown not configured' }, 500);
  });
}
