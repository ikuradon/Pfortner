import type { RedisClient } from '../plugins/types.ts';

export interface KvOptions {
  path?: string; // ':memory:' for in-memory, or file path
}

interface KvEntry {
  value: string;
  expiresAt?: number; // Unix timestamp in ms
}

export async function createKvClient(options: KvOptions = {}): Promise<RedisClient> {
  const kv = await Deno.openKv(options.path);

  async function getEntry(key: string): Promise<string | null> {
    const entry = await kv.get<KvEntry>(['data', key]);
    if (entry.value == null) return null;
    if (entry.value.expiresAt != null && Date.now() > entry.value.expiresAt) {
      await kv.delete(['data', key]);
      return null;
    }
    return entry.value.value;
  }

  return {
    get(key: string): Promise<string | null> {
      return getEntry(key);
    },
    async set(key: string, value: string, ttl?: number): Promise<void> {
      const entry: KvEntry = { value };
      if (ttl != null) {
        entry.expiresAt = Date.now() + ttl * 1000;
      }
      await kv.set(['data', key], entry);
    },
    async incr(key: string): Promise<number> {
      let result = 0;
      let success = false;
      while (!success) {
        const entry = await kv.get<KvEntry>(['data', key]);
        const currentValue = entry.value?.value;
        const expiresAt = entry.value?.expiresAt;
        // Check if expired
        const isExpired = expiresAt != null && Date.now() > expiresAt;
        const currentNum = (currentValue != null && !isExpired) ? parseInt(currentValue, 10) : 0;
        const newValue = (isNaN(currentNum) ? 0 : currentNum) + 1;
        const newEntry: KvEntry = { value: String(newValue) };
        if (expiresAt != null && !isExpired) {
          newEntry.expiresAt = expiresAt;
        }
        const op = kv.atomic().check(entry).set(['data', key], newEntry);
        const res = await op.commit();
        if (res.ok) {
          result = newValue;
          success = true;
        }
      }
      return result;
    },
    async expire(key: string, ttl: number): Promise<void> {
      const entry = await kv.get<KvEntry>(['data', key]);
      if (entry.value != null) {
        const newEntry: KvEntry = { value: entry.value.value, expiresAt: Date.now() + ttl * 1000 };
        await kv.set(['data', key], newEntry);
      }
    },
    async sadd(key: string, ...members: string[]): Promise<number> {
      let added = 0;
      for (const member of members) {
        const existing = await kv.get(['set', key, member]);
        if (existing.value == null) {
          await kv.set(['set', key, member], true);
          added++;
        }
      }
      return added;
    },
    async sismember(key: string, member: string): Promise<boolean> {
      const entry = await kv.get(['set', key, member]);
      return entry.value != null;
    },
    async del(...keys: string[]): Promise<number> {
      let deleted = 0;
      for (const key of keys) {
        // Delete data key
        const entry = await kv.get<KvEntry>(['data', key]);
        if (entry.value != null) {
          await kv.delete(['data', key]);
          deleted++;
        }
        // Delete set members
        const iter = kv.list({ prefix: ['set', key] });
        for await (const setEntry of iter) {
          await kv.delete(setEntry.key);
        }
        // Delete sorted set members
        const ziter = kv.list({ prefix: ['zset', key] });
        for await (const zEntry of ziter) {
          await kv.delete(zEntry.key);
        }
      }
      return deleted;
    },
    async zadd(key: string, score: number, member: string): Promise<number> {
      await kv.set(['zset', key, member], score);
      return 1;
    },
    async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
      let removed = 0;
      const iter = kv.list<number>({ prefix: ['zset', key] });
      for await (const entry of iter) {
        if (entry.value >= min && entry.value <= max) {
          await kv.delete(entry.key);
          removed++;
        }
      }
      return removed;
    },
    async zcard(key: string): Promise<number> {
      let count = 0;
      const iter = kv.list({ prefix: ['zset', key] });
      for await (const _entry of iter) count++;
      return count;
    },
    close(): Promise<void> {
      kv.close();
      return Promise.resolve();
    },
  };
}
