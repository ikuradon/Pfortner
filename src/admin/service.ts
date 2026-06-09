import type { PfortnerConfig, PipelineEntry } from '../config/loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { LogBuffer, LogEntry } from '../infra/log-buffer.ts';
import type { ThroughputTracker } from '../infra/throughput-tracker.ts';
import { evaluateCondition } from '../conditions/evaluator.ts';
import { buildEvalContext } from '../conditions/context.ts';
import { extractEvent } from '../plugins/types.ts';

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
  logBuffer?: LogBuffer;
}

export interface LogsResult {
  logs: LogEntry[];
  total: number;
  subscribers: number;
}

export interface AdminConnectionDto {
  id: string;
  ip: string;
  authenticated: boolean;
  pubkey: string;
  connectedAt: string | null;
}

const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 1000;

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
    memory = { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal };
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

export function toAdminConnectionDto(managed: ManagedConnection): AdminConnectionDto {
  return {
    id: managed.info.connectionId,
    ip: managed.clientIp || managed.info.connectionIpAddr || '',
    authenticated: managed.info.clientAuthorized,
    pubkey: managed.info.clientPubkey,
    connectedAt: managed.connectedAt ?? null,
  };
}

export function getConnections(state: AdminServiceState): AdminConnectionDto[] {
  return [...state.connections.values()].map(toAdminConnectionDto);
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

export function parseLogLimit(value: string | number | null | undefined, fallback = DEFAULT_LOG_LIMIT): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  const parsed = Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
  return Math.max(1, Math.min(MAX_LOG_LIMIT, parsed));
}

export function getLogs(state: AdminServiceState, limit = DEFAULT_LOG_LIMIT): LogsResult {
  if (!state.logBuffer) {
    return { logs: [], total: 0, subscribers: 0 };
  }
  return {
    logs: state.logBuffer.list(parseLogLimit(limit)),
    total: state.logBuffer.size(),
    subscribers: state.logBuffer.subscriberCount(),
  };
}

export function createLogStreamResponse(
  state: AdminServiceState,
  options: { signal?: AbortSignal; replay?: number; heartbeatMs?: number } = {},
): Response {
  const logBuffer = state.logBuffer;
  if (!logBuffer) {
    return new Response(JSON.stringify({ error: 'log streaming not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let cleanupHeartbeat = () => {};

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };

      const abortHandler = () => close();

      function close() {
        if (closed) return;
        closed = true;
        unsubscribe();
        cleanupHeartbeat();
        options.signal?.removeEventListener('abort', abortHandler);
        try {
          controller.close();
        } catch {
          // stream が既に閉じている場合は何もしない。
        }
      }

      cleanup = close;

      if (options.signal?.aborted) {
        close();
        return;
      }

      options.signal?.addEventListener('abort', abortHandler, { once: true });

      for (const entry of logBuffer.list(parseLogLimit(options.replay, 100))) {
        send('log', entry);
      }

      send('heartbeat', { timestamp: new Date().toISOString() });

      unsubscribe = logBuffer.subscribe((entry) => {
        send('log', entry);
      });

      const heartbeatId = setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, options.heartbeatMs ?? 15000);
      cleanupHeartbeat = () => clearInterval(heartbeatId);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export interface SimulateStep {
  policy: string;
  action: string;
  response?: string;
  branch?: string;
  detail?: string;
}

export interface SimulateResult {
  steps: SimulateStep[];
  finalAction: string;
  finalResponse?: string;
}

/** Simulate pipeline execution without instantiating real policies. */
export async function simulatePipeline(
  pipeline: PipelineEntry[],
  message: unknown[],
  connectionInfo: { clientAuthorized: boolean; clientPubkey: string; connectionIpAddr: string },
): Promise<SimulateResult> {
  const steps: SimulateStep[] = [];
  const ctx = buildEvalContext(message, connectionInfo);
  const messageType = (message[0] as string) ?? '';

  async function runEntries(entries: PipelineEntry[]): Promise<{ action: string; response?: string }> {
    for (const entry of entries) {
      const policyName = entry.policy;
      const cfg = entry.config ?? {};

      // Handle when plugin
      if (policyName === 'when') {
        const condition = (cfg as any).condition;
        const thenPipeline: PipelineEntry[] = (cfg as any).then ?? [];
        const elsePipeline: PipelineEntry[] = (cfg as any).else ?? [];
        let matched = false;
        try {
          matched = condition ? evaluateCondition(condition, ctx) : false;
        } catch {
          matched = false;
        }
        const branch = matched ? 'then' : 'else';
        const subPipeline = matched ? thenPipeline : elsePipeline;
        steps.push({
          policy: 'when',
          action: 'next',
          branch,
          detail: `condition ${matched ? 'matched' : 'did not match'} → ${branch}`,
        });
        if (subPipeline.length > 0) {
          const subResult = await runEntries(subPipeline);
          if (subResult.action !== 'next') return subResult;
        }
        continue;
      }

      // Handle match plugin
      if (policyName === 'match') {
        const cases: Array<{ condition: unknown; pipeline: PipelineEntry[] }> = (cfg as any).cases ?? [];
        const defaultPipeline: PipelineEntry[] = (cfg as any).default ?? [];
        let matchedCase: { condition: unknown; pipeline: PipelineEntry[] } | null = null;
        for (const c of cases) {
          try {
            if (c.condition && evaluateCondition(c.condition as any, ctx)) {
              matchedCase = c;
              break;
            }
          } catch { /* ignore */ }
        }
        if (matchedCase) {
          steps.push({ policy: 'match', action: 'next', branch: 'case', detail: 'matched case' });
          const subResult = await runEntries(matchedCase.pipeline);
          if (subResult.action !== 'next') return subResult;
        } else if (defaultPipeline.length > 0) {
          steps.push({ policy: 'match', action: 'next', branch: 'default', detail: 'no case matched, using default' });
          const subResult = await runEntries(defaultPipeline);
          if (subResult.action !== 'next') return subResult;
        } else {
          steps.push({ policy: 'match', action: 'next', detail: 'no case matched, no default' });
        }
        continue;
      }

      // Simulate other policies based on config and message
      const step = simulatePolicyStep(policyName, cfg, message, messageType, ctx, connectionInfo);
      steps.push(step);
      if (step.action !== 'next') {
        return { action: step.action, response: step.response };
      }
    }
    return { action: 'next' };
  }

  const final = await runEntries(pipeline);
  const finalAction = final.action === 'next' ? 'accept' : final.action;
  return { steps, finalAction, finalResponse: final.response };
}

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return NaN;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrContains(network: string, ip: string, prefix: number): boolean {
  if (prefix < 0 || prefix > 32) return false;
  const networkNumber = ipToNumber(network);
  const ipNumber = ipToNumber(ip);
  if (Number.isNaN(networkNumber) || Number.isNaN(ipNumber)) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (networkNumber & mask);
}

function simulatePolicyStep(
  policyName: string,
  cfg: Record<string, unknown>,
  _message: unknown[],
  messageType: string,
  ctx: ReturnType<typeof buildEvalContext>,
  connectionInfo: { clientAuthorized: boolean; clientPubkey: string; connectionIpAddr: string },
): SimulateStep {
  switch (policyName) {
    case 'accept':
      return { policy: policyName, action: 'accept' };

    case 'kind-filter': {
      const allowKinds = cfg['allow_kinds'] as number[] | undefined;
      const denyKinds = cfg['deny_kinds'] as number[] | undefined;
      const requireAuthFor = cfg['require_auth_for'] as number[] | undefined;
      if (messageType === 'EVENT' && ctx.eventKind !== null) {
        if (denyKinds && denyKinds.includes(ctx.eventKind)) {
          return { policy: policyName, action: 'reject', response: `kind ${ctx.eventKind} is not allowed` };
        }
        if (allowKinds && !allowKinds.includes(ctx.eventKind)) {
          return { policy: policyName, action: 'reject', response: `kind ${ctx.eventKind} is not allowed` };
        }
        if (requireAuthFor && requireAuthFor.includes(ctx.eventKind) && !connectionInfo.clientAuthorized) {
          return { policy: policyName, action: 'reject', response: 'authentication required' };
        }
      }
      return { policy: policyName, action: 'next' };
    }

    case 'write-guard': {
      if (messageType === 'EVENT') {
        const requireAuth = cfg['require_auth'] as boolean | undefined;
        if (requireAuth && !connectionInfo.clientAuthorized) {
          return { policy: policyName, action: 'reject', response: 'authentication required' };
        }
      }
      return { policy: policyName, action: 'next' };
    }

    case 'protected-event': {
      if (messageType !== 'EVENT' || _message.length < 3) return { policy: policyName, action: 'next' };
      const requireAuth = cfg['require_auth'] as boolean | undefined;
      const event = extractEvent(_message)?.event as { tags?: string[][] } | undefined;
      const isProtected = event?.tags?.some((tag) => tag.length >= 1 && tag[0] === '-');
      if (requireAuth && isProtected) {
        if (!connectionInfo.clientAuthorized) {
          return { policy: policyName, action: 'reject', response: 'authentication required for protected events' };
        }
      }
      return { policy: policyName, action: 'next' };
    }

    case 'rate-limit': {
      // Simulate pass-through (real rate limiting needs state)
      return { policy: policyName, action: 'next', detail: 'rate limit check (simulated: pass)' };
    }

    case 'spam-filter': {
      return { policy: policyName, action: 'next', detail: 'spam check (simulated: pass)' };
    }

    case 'content-filter': {
      return { policy: policyName, action: 'next', detail: 'content check (simulated: pass)' };
    }

    case 'pubkey-acl': {
      const mode = cfg['mode'] as string | undefined;
      const target = cfg['target'] as string | undefined;
      const pubkeys = cfg['pubkeys'] as string[] | undefined;
      const event = extractEvent(_message)?.event as { pubkey?: string } | undefined;
      if (!event) return { policy: policyName, action: 'next' };
      const pubkey = target === 'client' ? connectionInfo.clientPubkey : event?.pubkey;
      if (target === 'client' && !pubkey && mode === 'whitelist') {
        return { policy: policyName, action: 'reject', response: 'pubkey is not allowed' };
      }
      if (!pubkey) return { policy: policyName, action: 'next' };
      const inList = pubkeys?.includes(pubkey) ?? false;
      if (mode === 'blacklist' && inList) {
        return { policy: policyName, action: 'reject', response: 'pubkey is blocked' };
      }
      if (mode === 'whitelist' && !inList) {
        return { policy: policyName, action: 'reject', response: 'pubkey is not allowed' };
      }
      return { policy: policyName, action: 'next' };
    }

    case 'ip-filter': {
      const blacklist = cfg['blacklist'] as { ips?: string[]; cidrs?: string[] } | undefined;
      const ip = connectionInfo.connectionIpAddr;
      if (blacklist?.ips && ip && blacklist.ips.includes(ip)) {
        return { policy: policyName, action: 'reject', response: 'IP is blocked' };
      }
      if (blacklist?.cidrs && ip) {
        for (const cidr of blacklist.cidrs) {
          const [network, prefixStr] = cidr.split('/');
          const prefix = Number(prefixStr);
          if (Number.isInteger(prefix) && cidrContains(network, ip, prefix)) {
            return { policy: policyName, action: 'reject', response: 'IP is blocked' };
          }
        }
      }
      return { policy: policyName, action: 'next' };
    }

    case 'route': {
      return { policy: policyName, action: 'next', detail: 'route (simulated: pass)' };
    }

    default:
      return { policy: policyName, action: 'next', detail: 'unknown policy (simulated: pass)' };
  }
}
