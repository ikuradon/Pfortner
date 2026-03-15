import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';

interface SpamFilterConfig {
  min_pow?: number;
  max_content_length?: number;
  reject_duplicate?: { enabled: boolean; window: number; backend?: string };
}

// Shared duplicate detection set
const seenEventIds = new Map<string, number>(); // eventId -> timestamp

function cleanExpired(windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  for (const [id, ts] of seenEventIds) {
    if (ts < cutoff) seenEventIds.delete(id);
  }
}

function countLeadingZeroBits(hex: string): number {
  let count = 0;
  for (const ch of hex) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) {
      count += 4;
      continue;
    }
    // count leading zeros in this nibble
    if (nibble < 2) count += 3;
    else if (nibble < 4) count += 2;
    else if (nibble < 8) count += 1;
    break;
  }
  return count;
}

export const spamFilterPlugin: PolicyPlugin = {
  name: 'spam-filter',
  description: 'Filter spam EVENTs by PoW, content length, and duplicate detection',
  direction: 'client',
  configSchema: {
    type: 'object',
    properties: {
      min_pow: { type: 'number' },
      max_content_length: { type: 'number' },
      reject_duplicate: {
        type: 'object',
        properties: { enabled: { type: 'boolean' }, window: { type: 'number' } },
      },
    },
  },
  initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as SpamFilterConfig;
    const dupWindowMs = (cfg.reject_duplicate?.window ?? 300) * 1000;
    const useRedis = cfg.reject_duplicate?.backend === 'redis' && infra.redis != null;
    const redis = infra.redis;

    return Promise.resolve((_instance) => {
      return async (message, _connectionInfo) => {
        if (message[0] !== 'EVENT' || message.length < 2) {
          return { message, action: 'next' };
        }

        const event = message[1] as { id: string; content: string; tags: string[][] };

        // Content length check
        if (cfg.max_content_length != null) {
          const byteLength = new TextEncoder().encode(event.content ?? '').length;
          if (byteLength > cfg.max_content_length) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['OK', event.id, false, 'blocked: content too long']),
            };
          }
        }

        // PoW check (NIP-13: count leading zero bits of event ID)
        if (cfg.min_pow != null && cfg.min_pow > 0) {
          const pow = countLeadingZeroBits(event.id);
          if (pow < cfg.min_pow) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify([
                'OK',
                event.id,
                false,
                `blocked: insufficient PoW (need ${cfg.min_pow}, got ${pow})`,
              ]),
            };
          }
        }

        // Duplicate detection
        if (cfg.reject_duplicate?.enabled) {
          if (useRedis && redis) {
            // Redis path: GET/SET with TTL for duplicate check
            const existing = await redis.get(`seen:${event.id}`);
            if (existing) {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', event.id, false, 'duplicate: already seen']),
              };
            }
            await redis.set(`seen:${event.id}`, '1', cfg.reject_duplicate.window);
          } else {
            // In-memory path (existing code)
            cleanExpired(dupWindowMs);
            if (seenEventIds.has(event.id)) {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', event.id, false, 'duplicate: already seen']),
              };
            }
            seenEventIds.set(event.id, Date.now());
          }
        }

        return { message, action: 'next' };
      };
    });
  },
  destroy(): Promise<void> {
    seenEventIds.clear();
    return Promise.resolve();
  },
};
