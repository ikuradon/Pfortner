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

// Shared sliding window counters (across connections for ip/pubkey scopes)
const sharedCounters = new Map<string, { events: number[]; requests: number[] }>();

function getCounters(key: string) {
  let c = sharedCounters.get(key);
  if (!c) {
    c = { events: [], requests: [] };
    sharedCounters.set(key, c);
  }
  return c;
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

    return Promise.resolve((_instance) => {
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

        // In-memory path (existing code, unchanged)
        const counters = getCounters(key);

        if (type === 'EVENT') {
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
        } else {
          const count = countInWindow(counters.requests, windowMs, now);
          if (count >= maxRequests) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['CLOSED', message[1] ?? '', rejectMsg]),
            };
          }
          counters.requests.push(now);
        }

        return { message, action: 'next' };
      };
    });
  },
  destroy(): Promise<void> {
    sharedCounters.clear();
    return Promise.resolve();
  },
};
