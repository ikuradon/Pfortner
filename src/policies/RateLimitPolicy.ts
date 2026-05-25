import type { ConnectionInfo, InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';

interface RateLimitConfig {
  scope: 'pubkey' | 'ip' | 'connection';
  window: number;
  max_events?: number;
  max_requests?: number;
  burst?: number;
  backend?: 'memory' | 'redis';
  on_reject?: { message: string };
}

interface Counters {
  events: number[];
  requests: number[];
  expiresAt: number;
  windowMs: number;
}

// Shared sliding window counters (across connections for ip/pubkey scopes)
const sharedCounters = new Map<string, Counters>();
const nextPruneByNamespace = new Map<string, number>();
let nextMemoryPolicyId = 0;

export const __testing = {
  sharedCounterCount(): number {
    return sharedCounters.size;
  },
  sharedCountersForKey(key: string): { events: number; requests: number } | undefined {
    const counters = sharedCounters.get(key);
    if (!counters) return undefined;
    return { events: counters.events.length, requests: counters.requests.length };
  },
};

function getCounters(key: string, windowMs: number) {
  let c = sharedCounters.get(key);
  if (!c) {
    c = { events: [], requests: [], expiresAt: 0, windowMs };
    sharedCounters.set(key, c);
  }
  return c;
}

function maybePruneSharedCounters(namespace: string, windowMs: number, now: number): void {
  const nextPruneAt = nextPruneByNamespace.get(namespace) ?? 0;
  if (now < nextPruneAt) return;
  nextPruneByNamespace.set(namespace, now + Math.min(Math.max(windowMs, 1000), 60_000));

  for (const [key, counters] of sharedCounters) {
    if (!key.startsWith(namespace)) continue;
    if (counters.expiresAt > now) continue;
    countInWindow(counters.events, counters.windowMs, now);
    countInWindow(counters.requests, counters.windowMs, now);
    if (counters.events.length === 0 && counters.requests.length === 0) {
      sharedCounters.delete(key);
    } else {
      counters.expiresAt = now + counters.windowMs;
    }
  }
}

function countInWindow(timestamps: number[], windowMs: number, now: number): number {
  // Remove expired entries
  while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
    timestamps.shift();
  }
  return timestamps.length;
}

function getScopeKey(scope: string, connectionInfo: ConnectionInfo): string {
  switch (scope) {
    case 'pubkey':
      return connectionInfo.clientPubkey || `ip:${connectionInfo.connectionIpAddr}`;
    case 'ip':
      return `ip:${connectionInfo.connectionIpAddr}`;
    case 'connection':
    default:
      return `conn:${connectionInfo.connectionId}`;
  }
}

export const rateLimitPlugin: PolicyPlugin = {
  name: 'rate-limit',
  description: 'Rate limit EVENT and REQ messages by connection, IP, or pubkey',
  direction: 'client',
  configSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['pubkey', 'ip', 'connection'] },
      window: { type: 'number' },
      max_events: { type: 'number' },
      max_requests: { type: 'number' },
      burst: { type: 'number' },
      on_reject: { type: 'object', properties: { message: { type: 'string' } } },
    },
    required: ['scope', 'window'],
  },
  initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as RateLimitConfig;
    const windowMs = cfg.window * 1000;
    const maxEvents = cfg.max_events ?? Infinity;
    const maxRequests = cfg.max_requests ?? Infinity;
    const rejectMsg = cfg.on_reject?.message ?? 'rate-limited: slow down';
    const useRedis = cfg.backend === 'redis' && infra.redis != null;
    const redis = infra.redis;
    const memoryNamespace = `policy:${nextMemoryPolicyId++}:`;

    return Promise.resolve((_instance) => {
      const connectionCounters = cfg.scope === 'connection'
        ? { events: [] as number[], requests: [] as number[], expiresAt: 0, windowMs }
        : null;

      return async (message, connectionInfo) => {
        const type = message[0];
        if (type !== 'EVENT' && type !== 'REQ') {
          return { message, action: 'next' };
        }

        const key = getScopeKey(cfg.scope, connectionInfo);
        const now = Date.now();

        if (useRedis && redis) {
          // Redis sorted set path (sliding window)
          const eventKey = `events:${key}`;
          const reqKey = `requests:${key}`;

          if (type === 'EVENT') {
            await redis.zremrangebyscore(eventKey, 0, now - windowMs);
            const count = await redis.zcard(eventKey);
            if (count >= maxEvents) {
              const eventId = (message[1] as any)?.id ?? '';
              return { message, action: 'reject', response: JSON.stringify(['OK', eventId, false, rejectMsg]) };
            }
            await redis.zadd(eventKey, now, `${now}:${Math.random()}`);
            await redis.expire(eventKey, cfg.window + 1);
          } else {
            await redis.zremrangebyscore(reqKey, 0, now - windowMs);
            const count = await redis.zcard(reqKey);
            if (count >= maxRequests) {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['CLOSED', message[1] ?? '', rejectMsg]),
              };
            }
            await redis.zadd(reqKey, now, `${now}:${Math.random()}`);
            await redis.expire(reqKey, cfg.window + 1);
          }
          return { message, action: 'next' };
        }

        if (connectionCounters == null) {
          maybePruneSharedCounters(memoryNamespace, windowMs, now);
        }

        const counterKey = `${memoryNamespace}${key}`;

        if (type === 'EVENT') {
          if (maxEvents === Infinity) {
            return { message, action: 'next' };
          }
          const counters = connectionCounters ?? getCounters(counterKey, windowMs);
          const count = countInWindow(counters.events, windowMs, now);
          if (count >= maxEvents) {
            const eventId = (message[1] as any)?.id ?? '';
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['OK', eventId, false, rejectMsg]),
            };
          }
          counters.events.push(now);
          counters.expiresAt = now + windowMs;
        } else {
          if (maxRequests === Infinity) {
            return { message, action: 'next' };
          }
          const counters = connectionCounters ?? getCounters(counterKey, windowMs);
          const count = countInWindow(counters.requests, windowMs, now);
          if (count >= maxRequests) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['CLOSED', message[1] ?? '', rejectMsg]),
            };
          }
          counters.requests.push(now);
          counters.expiresAt = now + windowMs;
        }

        return { message, action: 'next' };
      };
    });
  },
  destroy(): Promise<void> {
    sharedCounters.clear();
    nextPruneByNamespace.clear();
    nextMemoryPolicyId = 0;
    return Promise.resolve();
  },
};
