import type { PfortnerConfig, PipelineEntry } from '../../config/loader.ts';
import { buildEvalContext } from '../../conditions/context.ts';
import { evaluateCondition } from '../../conditions/evaluator.ts';
import { extractEvent } from '../../plugins/types.ts';
import { normalizePipelineEntries } from './pipelines.ts';

type PlaygroundConnectionInfo = {
  clientAuthorized: boolean;
  clientPubkey: string;
  connectionIpAddr: string;
};

export type PlaygroundEvaluateInput = {
  message: unknown;
  direction?: unknown;
  pipeline?: unknown;
  connectionInfo?: unknown;
};

export type PlaygroundEvaluateResult =
  | { result: SimulateResult }
  | { error: string; status: number };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function evaluatePlaygroundRequest(
  config: PfortnerConfig,
  input: PlaygroundEvaluateInput,
): Promise<PlaygroundEvaluateResult> {
  if (!isRecord(input)) {
    return { error: 'request body object required', status: 400 };
  }

  const message = input.message;
  const direction = input.direction ?? 'client';
  const postedPipeline = input.pipeline === undefined ? null : normalizePipelineEntries(input.pipeline, 'pipeline');
  if (postedPipeline && 'error' in postedPipeline) {
    return { error: postedPipeline.error, status: 400 };
  }

  const connectionInfoBody = isRecord(input.connectionInfo) ? input.connectionInfo : {};
  const connectionInfo: PlaygroundConnectionInfo = {
    clientAuthorized: connectionInfoBody.authenticated === true,
    clientPubkey: typeof connectionInfoBody.pubkey === 'string' ? connectionInfoBody.pubkey : '',
    connectionIpAddr: typeof connectionInfoBody.clientIp === 'string' ? connectionInfoBody.clientIp : '127.0.0.1',
  };

  if (!Array.isArray(message)) {
    return { error: 'message must be an array', status: 400 };
  }

  const pipeline = postedPipeline?.entries ??
    (direction === 'server' ? (config.pipelines?.server ?? []) : (config.pipelines?.client ?? []));
  const result = await simulatePipeline(pipeline, message, connectionInfo);
  return { result };
}

export async function simulatePipeline(
  pipeline: PipelineEntry[],
  message: unknown[],
  connectionInfo: PlaygroundConnectionInfo,
): Promise<SimulateResult> {
  const steps: SimulateStep[] = [];
  const ctx = buildEvalContext(message, connectionInfo);
  const messageType = (message[0] as string) ?? '';

  async function runEntries(entries: PipelineEntry[]): Promise<{ action: string; response?: string }> {
    for (const entry of entries) {
      const policyName = entry.policy;
      const cfg = entry.config ?? {};

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
          } catch {
            // 個別 case の評価失敗は、既存 simulator と同じく不一致として扱う。
          }
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
  message: unknown[],
  messageType: string,
  ctx: ReturnType<typeof buildEvalContext>,
  connectionInfo: PlaygroundConnectionInfo,
): SimulateStep {
  switch (policyName) {
    case 'accept':
      return { policy: policyName, action: 'accept' };

    case 'kind-filter': {
      const mode = cfg['mode'] as string | undefined;
      const kinds = cfg['kinds'] as number[] | undefined;
      const allowKinds = cfg['allow_kinds'] as number[] | undefined;
      const denyKinds = cfg['deny_kinds'] as number[] | undefined;
      const requireAuthFor = cfg['require_auth_for'] as number[] | undefined;
      if (messageType === 'EVENT' && ctx.eventKind !== null) {
        if (requireAuthFor && requireAuthFor.includes(ctx.eventKind) && !connectionInfo.clientAuthorized) {
          return { policy: policyName, action: 'reject', response: 'authentication required' };
        }
        if (mode === 'deny' && kinds?.includes(ctx.eventKind)) {
          return { policy: policyName, action: 'reject', response: `kind ${ctx.eventKind} is not allowed` };
        }
        if (mode === 'allow' && kinds && !kinds.includes(ctx.eventKind)) {
          return { policy: policyName, action: 'reject', response: `kind ${ctx.eventKind} is not allowed` };
        }
        if (denyKinds && denyKinds.includes(ctx.eventKind)) {
          return { policy: policyName, action: 'reject', response: `kind ${ctx.eventKind} is not allowed` };
        }
        if (allowKinds && !allowKinds.includes(ctx.eventKind)) {
          return { policy: policyName, action: 'reject', response: `kind ${ctx.eventKind} is not allowed` };
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
      if (messageType !== 'EVENT' || message.length < 3) return { policy: policyName, action: 'next' };
      const requireAuth = cfg['require_auth'] as boolean | undefined;
      const event = extractEvent(message)?.event as { tags?: string[][] } | undefined;
      const isProtected = event?.tags?.some((tag) => tag.length >= 1 && tag[0] === '-');
      if (requireAuth && isProtected) {
        if (!connectionInfo.clientAuthorized) {
          return { policy: policyName, action: 'reject', response: 'authentication required for protected events' };
        }
      }
      return { policy: policyName, action: 'next' };
    }

    case 'rate-limit':
      return { policy: policyName, action: 'next', detail: 'rate limit check (simulated: pass)' };

    case 'spam-filter':
      return { policy: policyName, action: 'next', detail: 'spam check (simulated: pass)' };

    case 'content-filter':
      return { policy: policyName, action: 'next', detail: 'content check (simulated: pass)' };

    case 'pubkey-acl': {
      const mode = cfg['mode'] as string | undefined;
      const target = cfg['target'] as string | undefined;
      const pubkeys = cfg['pubkeys'] as string[] | undefined;
      const event = extractEvent(message)?.event as { pubkey?: string } | undefined;
      if (!event) return { policy: policyName, action: 'next' };
      const pubkey = target === 'client' ? connectionInfo.clientPubkey : event?.pubkey;
      if (target === 'client' && !pubkey && mode === 'allowlist') {
        return { policy: policyName, action: 'reject', response: 'pubkey is not allowed' };
      }
      if (!pubkey) return { policy: policyName, action: 'next' };
      const inList = pubkeys?.includes(pubkey) ?? false;
      if (mode === 'blocklist' && inList) {
        return { policy: policyName, action: 'reject', response: 'pubkey is blocked' };
      }
      if (mode === 'allowlist' && !inList) {
        return { policy: policyName, action: 'reject', response: 'pubkey is not allowed' };
      }
      return { policy: policyName, action: 'next' };
    }

    case 'ip-filter': {
      const blocklist = cfg['blocklist'] as { ips?: string[]; cidrs?: string[] } | undefined;
      const ip = connectionInfo.connectionIpAddr;
      if (blocklist?.ips && ip && blocklist.ips.includes(ip)) {
        return { policy: policyName, action: 'reject', response: 'IP is blocked' };
      }
      if (blocklist?.cidrs && ip) {
        for (const cidr of blocklist.cidrs) {
          const [network, prefixStr] = cidr.split('/');
          const prefix = Number(prefixStr);
          if (Number.isInteger(prefix) && cidrContains(network, ip, prefix)) {
            return { policy: policyName, action: 'reject', response: 'IP is blocked' };
          }
        }
      }
      return { policy: policyName, action: 'next' };
    }

    case 'route':
      return { policy: policyName, action: 'next', detail: 'route (simulated: pass)' };

    default:
      return { policy: policyName, action: 'next', detail: 'unknown policy (simulated: pass)' };
  }
}
