import type { AdminState } from '$admin/server.ts';
import {
  normalizePipelineWorkbenchDraft,
  readPipelineWorkbenchDraft,
  writePipelineWorkbenchDraft,
} from '$admin/actions/pipeline_draft.ts';
import { closeConnectionBatch } from '$admin/actions/connections.ts';
import { savePipelinesToConfig } from '$admin/actions/pipelines.ts';
import { evaluatePlaygroundRequest } from '$admin/actions/playground.ts';
import { addIp, addPubkey, deleteIp, deletePubkey, listBlocklist } from '$admin/actions/blocklist.ts';
import { reloadConfig } from '$admin/actions/reload.ts';
import { shutdownAdmin } from '$admin/actions/shutdown.ts';
import {
  getConnections,
  getHealthDetail,
  getHealthSimple,
  getLogs,
  getThroughputData,
  maskSecrets,
  parseLogLimit,
} from '$admin/service.ts';
import { getRuntimeInfo } from '$admin/read_models/runtime.ts';
import { createLogStreamResponse } from '../../http/log_stream.ts';
import { json } from './json.ts';
import type { AdminRouteApp } from '../route_types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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

  app.get(`${adminPath}/api/runtime`, (_ctx) => {
    return json(getRuntimeInfo(state));
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
      const saved = await savePipelinesToConfig(state, body.pipelines);
      if ('error' in saved) return json({ error: saved.error }, saved.status);
      return json({ status: 'saved', pipelines: saved.pipelines });
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
      const evaluated = await evaluatePlaygroundRequest(state.config, body);
      if ('error' in evaluated) return json({ error: evaluated.error }, evaluated.status);
      return json(evaluated.result);
    } catch (e) {
      return json({ error: `evaluation failed: ${(e as Error).message}` }, 500);
    }
  });

  app.get(`${adminPath}/api/blocklist`, (_ctx) => {
    return json(listBlocklist(state.blocklist));
  });

  app.post(`${adminPath}/api/blocklist/pubkey`, async (ctx) => {
    const body = await ctx.req.json();
    const result = addPubkey(state.blocklist, isRecord(body) ? body.pubkey : undefined);
    if ('error' in result) return json({ error: result.error }, 400);
    return json(result);
  });

  app.delete(`${adminPath}/api/blocklist/pubkey/:pk`, (ctx) => {
    const result = deletePubkey(state.blocklist, ctx.params.pk ?? '');
    if ('error' in result) return json({ error: result.error }, 400);
    return json(result);
  });

  app.post(`${adminPath}/api/blocklist/ip`, async (ctx) => {
    const body = await ctx.req.json();
    const result = addIp(state.blocklist, isRecord(body) ? body.ip : undefined);
    if ('error' in result) return json({ error: result.error }, 400);
    return json(result);
  });

  app.delete(`${adminPath}/api/blocklist/ip/:ip`, (ctx) => {
    const result = deleteIp(state.blocklist, ctx.params.ip ?? '');
    if ('error' in result) return json({ error: result.error }, 400);
    return json(result);
  });

  app.post(`${adminPath}/api/reload`, async (_ctx) => {
    const result = await reloadConfig(state);
    if ('error' in result) return json({ error: result.error }, result.status);
    return new Response(null, {
      status: 302,
      headers: { Location: `${adminPath}/` },
    });
  });

  app.post(`${adminPath}/api/shutdown`, (_ctx) => {
    const result = shutdownAdmin(state);
    if ('error' in result) return json({ error: result.error }, result.status);
    return new Response(null, {
      status: 302,
      headers: { Location: `${adminPath}/` },
    });
  });
}
