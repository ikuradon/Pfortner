import { createClient } from 'redis';
import type { RedisClient } from '../plugins/types.ts';

export interface RedisOptions {
  url: string;
  keyPrefix?: string;
}

const slidingWindowAddScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
local limit = tonumber(ARGV[2])
local ttl = math.max(1, math.ceil(tonumber(ARGV[5])))
if count >= limit then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('EXPIRE', KEYS[1], ttl)
return 1
`;

function ttlSeconds(ttl: number): number {
  return Math.max(1, Math.ceil(ttl));
}

export async function createRedisClient(options: RedisOptions): Promise<RedisClient> {
  const prefix = options.keyPrefix ?? '';
  const client = createClient({ url: options.url });
  await client.connect();

  return {
    async get(key: string): Promise<string | null> {
      return await client.get(prefix + key);
    },
    async set(key: string, value: string, ttl?: number): Promise<void> {
      if (ttl != null) {
        await client.set(prefix + key, value, { EX: ttlSeconds(ttl) });
      } else {
        await client.set(prefix + key, value);
      }
    },
    async setIfAbsent(key: string, value: string, ttl?: number): Promise<boolean> {
      const result = ttl != null
        ? await client.set(prefix + key, value, { EX: ttlSeconds(ttl), NX: true })
        : await client.set(prefix + key, value, { NX: true });
      return result === 'OK';
    },
    async incr(key: string): Promise<number> {
      return await client.incr(prefix + key);
    },
    async expire(key: string, ttl: number): Promise<void> {
      await client.expire(prefix + key, ttl);
    },
    async sadd(key: string, ...members: string[]): Promise<number> {
      return await client.sAdd(prefix + key, members);
    },
    async sismember(key: string, member: string): Promise<boolean> {
      return (await client.sIsMember(prefix + key, member)) === 1;
    },
    async del(...keys: string[]): Promise<number> {
      return await client.del(keys.map((k) => prefix + k));
    },
    async zadd(key: string, score: number, member: string): Promise<number> {
      return await client.zAdd(prefix + key, [{ score, value: member }]);
    },
    async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
      return await client.zRemRangeByScore(prefix + key, min, max);
    },
    async zcard(key: string): Promise<number> {
      return await client.zCard(prefix + key);
    },
    async slidingWindowAdd(
      key: string,
      windowStart: number,
      limit: number,
      score: number,
      member: string,
      ttl: number,
    ): Promise<boolean> {
      const result = await client.eval(slidingWindowAddScript, {
        keys: [prefix + key],
        arguments: [String(windowStart), String(limit), String(score), member, String(ttl)],
      });
      return result === 1;
    },
    async close(): Promise<void> {
      await client.quit();
    },
  };
}
