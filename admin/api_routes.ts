import { stringify as stringifyYaml } from '@std/yaml';
import type { AdminState } from '$admin/server.ts';
import type { PfortnerConfig, PipelineEntry } from '../src/config/loader.ts';
import {
  normalizePipelineWorkbenchDraft,
  readPipelineWorkbenchDraft,
  writePipelineWorkbenchDraft,
} from '../src/admin/pipeline_draft.ts';
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
import { json } from './http/json.ts';
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

  app.get(`${adminPath}/api/pipeline-draft`, async (_ctx) => {
    if (!state.pipelineDraftPath) return json({ draft: null });
    try {
      const draft = await readPipelineWorkbenchDraft(state.pipelineDraftPath);
      return json({ draft });
    } catch (e) {
      return json({ error: `pipeline draft read failed: ${(e as Error).message}` }, 500);
    }
  });

  app.post(`${adminPath}/api/pipeline-draft`, async (ctx) => {
    if (!state.pipelineDraftPath) {
      return json({ error: 'pipeline draft save not configured' }, 500);
    }
    try {
      const body = await ctx.req.json();
      if (!isRecord(body)) return json({ error: 'draft object required' }, 400);
      const normalized = normalizePipelineWorkbenchDraft(body.draft);
      if ('error' in normalized) return json({ error: normalized.error }, 400);
      await writePipelineWorkbenchDraft(state.pipelineDraftPath, normalized.draft);
      return json({ status: 'saved', draft: normalized.draft });
    } catch (e) {
      return json({ error: `pipeline draft save failed: ${(e as Error).message}` }, 500);
    }
  });

  app.post(`${adminPath}/api/pipelines`, async (ctx) => {
    if (!state.configPath || !state.reloadFn) {
      return json({ error: 'pipeline save not configured' }, 500);
    }
    try {
      const body = await ctx.req.json();
      if (!isRecord(body)) return json({ error: 'pipelines object required' }, 400);
      const normalized = normalizePipelines(body.pipelines);
      if ('error' in normalized) {
        return json({ error: normalized.error }, 400);
      }

      const nextConfig: PfortnerConfig = {
        ...state.config,
        pipelines: normalized.pipelines,
      };
      const yaml = stringifyConfig(nextConfig);
      await state.reloadFn(yaml);
      await Deno.writeTextFile(state.configPath, yaml);
      return json({
        status: 'saved',
        pipelines: state.config.pipelines ?? normalized.pipelines,
      });
    } catch (e) {
      return json(
        { error: `pipeline save failed: ${(e as Error).message}` },
        500,
      );
    }
  });

  app.post(`${adminPath}/api/playground/evaluate`, async (ctx) => {
    try {
      const body = await ctx.req.json();
      if (!isRecord(body)) return json({ error: 'request body object required' }, 400);
      const message = body.message;
      const direction = body.direction ?? 'client';
      const postedPipeline = body.pipeline === undefined ? null : normalizePipelineEntries(body.pipeline, 'pipeline');
      if (postedPipeline && 'error' in postedPipeline) {
        return json({ error: postedPipeline.error }, 400);
      }
      const connectionInfoBody = isRecord(body.connectionInfo) ? body.connectionInfo : {};
      const connectionInfo = {
        clientAuthorized: connectionInfoBody.authenticated === true,
        clientPubkey: typeof connectionInfoBody.pubkey === 'string' ? connectionInfoBody.pubkey : '',
        connectionIpAddr: typeof connectionInfoBody.clientIp === 'string' ? connectionInfoBody.clientIp : '127.0.0.1',
      };
      if (!Array.isArray(message)) {
        return json({ error: 'message must be an array' }, 400);
      }
      const pipeline = postedPipeline?.entries ??
        (direction === 'server' ? (state.config.pipelines?.server ?? []) : (state.config.pipelines?.client ?? []));
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

type PipelineSet = PfortnerConfig['pipelines'];

function stringifyConfig(config: PfortnerConfig): string {
  return stringifyYaml(config).trimEnd() + '\n';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePipelines(
  value: unknown,
): { pipelines: PipelineSet } | { error: string } {
  if (!isRecord(value)) {
    return { error: 'pipelines object required' };
  }
  const client = normalizePipelineEntries(value.client, 'pipelines.client');
  if ('error' in client) return client;
  const server = normalizePipelineEntries(value.server, 'pipelines.server');
  if ('error' in server) return server;
  return { pipelines: { client: client.entries, server: server.entries } };
}

function normalizePipelineEntries(
  value: unknown,
  path: string,
): { entries: PipelineEntry[] } | { error: string } {
  if (!Array.isArray(value)) {
    return { error: `${path} must be an array` };
  }
  const entries: PipelineEntry[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!isRecord(entry)) {
      return { error: `${path}[${i}] must be an object` };
    }
    if (typeof entry.policy !== 'string' || entry.policy.trim().length === 0) {
      return { error: `${path}[${i}].policy must be a non-empty string` };
    }
    const normalized: PipelineEntry = { policy: entry.policy };
    if (entry.config !== undefined) {
      if (!isRecord(entry.config)) {
        return { error: `${path}[${i}].config must be an object` };
      }
      normalized.config = structuredClone(entry.config);
    }
    entries.push(normalized);
  }
  return { entries };
}
