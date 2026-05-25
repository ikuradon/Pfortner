import { nostrTools } from '../deps.ts';
import type { InfraContext, PolicyFactory, PolicyPlugin } from '../plugins/types.ts';

interface SpamFilterConfig {
  min_pow?: number;
  max_content_length?: number;
  reject_duplicate?: { enabled: boolean; window: number; backend?: string; max_cache_size?: number };
}

// Shared duplicate detection set
const seenEventIds = new Map<string, number>(); // eventId -> timestamp
const DEFAULT_MAX_CACHE_SIZE = 10_000;

function cleanExpired(windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  for (const [id, ts] of seenEventIds) {
    if (ts < cutoff) seenEventIds.delete(id);
    else break;
  }
}

function enforceMaxCacheSize(maxSize: number): void {
  while (seenEventIds.size > maxSize) {
    const oldestId = seenEventIds.keys().next().value;
    if (oldestId == null) break;
    seenEventIds.delete(oldestId);
  }
}

function getEventId(event: unknown): string {
  if (typeof event !== 'object' || event === null) return '';
  const id = (event as { id?: unknown }).id;
  return typeof id === 'string' ? id : '';
}

function isValidNostrEvent(event: unknown): event is nostrTools.Event {
  if (typeof event !== 'object' || event === null) return false;
  try {
    const candidate = event as nostrTools.Event;
    return nostrTools.validateEvent(candidate) &&
      nostrTools.getEventHash(candidate) === candidate.id &&
      nostrTools.verifyEvent(candidate);
  } catch {
    return false;
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
        properties: {
          enabled: { type: 'boolean' },
          window: { type: 'number' },
          max_cache_size: { type: 'number', minimum: 1 },
        },
      },
    },
  },
  initialize(config: unknown, infra: InfraContext): Promise<PolicyFactory> {
    const cfg = config as SpamFilterConfig;
    const dupWindowMs = (cfg.reject_duplicate?.window ?? 300) * 1000;
    const maxCacheSize = cfg.reject_duplicate?.max_cache_size ?? DEFAULT_MAX_CACHE_SIZE;
    const useRedis = cfg.reject_duplicate?.backend === 'redis' && infra.redis != null;
    const redis = infra.redis;

    return Promise.resolve((_instance) => {
      return async (message, _connectionInfo) => {
        if (message[0] !== 'EVENT' || message.length < 2) {
          return { message, action: 'next' };
        }

        const event = message[1] as { id?: unknown; content?: unknown; tags?: unknown };
        const eventId = getEventId(event);

        // Content length check
        if (cfg.max_content_length != null) {
          const content = typeof event.content === 'string' ? event.content : '';
          const byteLength = new TextEncoder().encode(content).length;
          if (byteLength > cfg.max_content_length) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['OK', eventId, false, 'blocked: content too long']),
            };
          }
        }

        // PoW check (NIP-13: count leading zero bits of event ID)
        if (cfg.min_pow != null && cfg.min_pow > 0) {
          const pow = countLeadingZeroBits(eventId);
          if (pow < cfg.min_pow) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify([
                'OK',
                eventId,
                false,
                `blocked: insufficient PoW (need ${cfg.min_pow}, got ${pow})`,
              ]),
            };
          }
        }

        // Duplicate detection
        if (cfg.reject_duplicate?.enabled) {
          if (!isValidNostrEvent(event)) {
            return {
              message,
              action: 'reject',
              response: JSON.stringify(['OK', eventId, false, 'blocked: invalid event']),
            };
          }
          if (useRedis && redis) {
            // Redis path: GET/SET with TTL for duplicate check
            const existing = await redis.get(`seen:${eventId}`);
            if (existing) {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', eventId, false, 'duplicate: already seen']),
              };
            }
            await redis.set(`seen:${eventId}`, '1', cfg.reject_duplicate.window);
          } else {
            // In-memory path (existing code)
            cleanExpired(dupWindowMs);
            if (seenEventIds.has(eventId)) {
              return {
                message,
                action: 'reject',
                response: JSON.stringify(['OK', eventId, false, 'duplicate: already seen']),
              };
            }
            seenEventIds.set(eventId, Date.now());
            enforceMaxCacheSize(maxCacheSize);
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
