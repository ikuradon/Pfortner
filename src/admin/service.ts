import type { PfortnerConfig, PipelineEntry } from '../config/loader.ts';
import type { ManagedConnection } from '../connections/types.ts';
import type { ThroughputTracker } from '../infra/throughput-tracker.ts';
import { evaluateCondition } from '../conditions/evaluator.ts';
import { buildEvalContext } from '../conditions/context.ts';

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
      if (messageType === 'EVENT' && ctx.eventKind === 1059) {
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
      const allowList = cfg['allow'] as string[] | undefined;
      const denyList = cfg['deny'] as string[] | undefined;
      const pubkey = connectionInfo.clientPubkey;
      if (denyList && pubkey && denyList.includes(pubkey)) {
        return { policy: policyName, action: 'reject', response: 'pubkey is blocked' };
      }
      if (allowList && allowList.length > 0 && pubkey && !allowList.includes(pubkey)) {
        return { policy: policyName, action: 'reject', response: 'pubkey is not allowed' };
      }
      return { policy: policyName, action: 'next' };
    }

    case 'ip-filter': {
      const allowList = cfg['allow'] as string[] | undefined;
      const denyList = cfg['deny'] as string[] | undefined;
      const ip = connectionInfo.connectionIpAddr;
      if (denyList && ip && denyList.includes(ip)) {
        return { policy: policyName, action: 'reject', response: 'IP is blocked' };
      }
      if (allowList && allowList.length > 0 && ip && !allowList.includes(ip)) {
        return { policy: policyName, action: 'reject', response: 'IP is not allowed' };
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
