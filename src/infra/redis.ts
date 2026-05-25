import { createClient } from 'redis';
import type { RedisClient } from '../plugins/types.ts';

export interface RedisOptions {
  url: string;
  keyPrefix?: string;
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
      if (ttl) {
        await client.set(prefix + key, value, { EX: ttl });
      } else {
        await client.set(prefix + key, value);
      }
    },
    async setIfAbsent(key: string, value: string, ttl?: number): Promise<boolean> {
      const result = ttl
        ? await client.set(prefix + key, value, { EX: ttl, NX: true })
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
      return await client.sIsMember(prefix + key, member);
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
    async close(): Promise<void> {
      await client.quit();
    },
  };
}
