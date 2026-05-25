import type { RedisClient } from '../plugins/types.ts';

export interface KvOptions {
  path?: string; // ':memory:' はインメモリ、それ以外はファイルパス
}

interface KvEntry {
  value: string;
  expiresAt?: number; // Unix timestamp（ミリ秒）
}

interface ZsetEntry {
  score: number;
  expiresAt?: number; // Unix timestamp（ミリ秒）
}

interface ExpiryIndex {
  namespace: 'data' | 'zset';
  key: string;
  member?: string;
  expiresAt: number;
}

export async function createKvClient(options: KvOptions = {}): Promise<RedisClient> {
  const kv = await Deno.openKv(options.path);
  const keyLocks = new Map<string, Promise<void>>();

  function ttlToExpiresAt(ttl: number): number {
    return Date.now() + ttl * 1000;
  }

  function ttlToExpireIn(ttl: number): number {
    return Math.max(1, Math.ceil(ttl * 1000));
  }

  function remainingExpireIn(expiresAt: number): number | undefined {
    const remaining = expiresAt - Date.now();
    return remaining > 0 ? Math.max(1, Math.ceil(remaining)) : undefined;
  }

  function isExpired(expiresAt?: number): boolean {
    return expiresAt != null && Date.now() > expiresAt;
  }

  function parseZsetEntry(value: number | ZsetEntry): ZsetEntry {
    return typeof value === 'number' ? { score: value } : value;
  }

  async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = keyLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lock = previous.catch(() => {}).then(() => current);
    keyLocks.set(key, lock);

    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (keyLocks.get(key) === lock) {
        keyLocks.delete(key);
      }
    }
  }

  function expiryIndexKey(index: ExpiryIndex): Deno.KvKey {
    return index.namespace === 'data'
      ? ['expires', index.expiresAt, 'data', index.key]
      : ['expires', index.expiresAt, 'zset', index.key, index.member ?? ''];
  }

  async function addExpiryIndex(index: ExpiryIndex): Promise<void> {
    const key = expiryIndexKey(index);
    await kv.set(key, index);
  }

  async function deleteExpiryIndex(index: ExpiryIndex): Promise<void> {
    await kv.delete(expiryIndexKey(index));
  }

  async function deleteZsetMember(key: string, member: string, entry: ZsetEntry): Promise<void> {
    if (entry.expiresAt != null) {
      await deleteExpiryIndex({ namespace: 'zset', key, member, expiresAt: entry.expiresAt });
    }
    await kv.delete(['zset', key, member]);
  }

  async function cleanupExpired(limit = 1000): Promise<void> {
    const now = Date.now();
    let checked = 0;
    const iter = kv.list<ExpiryIndex>({ prefix: ['expires'] });

    for await (const entry of iter) {
      if (checked++ >= limit) break;
      if (entry.value.expiresAt > now) break;

      if (entry.value.namespace === 'data') {
        const dataKey = ['data', entry.value.key];
        const data = await kv.get<KvEntry>(dataKey);
        if (data.value?.expiresAt === entry.value.expiresAt) {
          await kv.delete(dataKey);
        }
      } else if (entry.value.member != null) {
        const zKey = ['zset', entry.value.key, entry.value.member];
        const zEntry = await kv.get<number | ZsetEntry>(zKey);
        const parsed = zEntry.value == null ? null : parseZsetEntry(zEntry.value);
        if (parsed?.expiresAt === entry.value.expiresAt) {
          await kv.delete(zKey);
        }
      }

      await kv.delete(entry.key);
    }
  }

  async function getZsetExpiresAt(key: string): Promise<number | undefined> {
    const entry = await kv.get<KvEntry>(['zset-expiry', key]);
    if (entry.value == null) return undefined;
    if (isExpired(entry.value.expiresAt)) {
      await kv.delete(['zset-expiry', key]);
      return undefined;
    }
    return entry.value.expiresAt;
  }

  async function getEntry(key: string): Promise<string | null> {
    await cleanupExpired();
    const entry = await kv.get<KvEntry>(['data', key]);
    if (entry.value == null) return null;
    if (isExpired(entry.value.expiresAt)) {
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
      await cleanupExpired();
      const entry: KvEntry = { value };
      if (ttl != null) {
        entry.expiresAt = ttlToExpiresAt(ttl);
        await kv.set(['data', key], entry, { expireIn: ttlToExpireIn(ttl) });
        await addExpiryIndex({ namespace: 'data', key, expiresAt: entry.expiresAt });
        return;
      }
      await kv.set(['data', key], entry);
    },
    async incr(key: string): Promise<number> {
      await cleanupExpired();
      let result = 0;
      let success = false;
      while (!success) {
        const entry = await kv.get<KvEntry>(['data', key]);
        const currentValue = entry.value?.value;
        const expiresAt = entry.value?.expiresAt;
        const expired = isExpired(expiresAt);
        const currentNum = (currentValue != null && !expired) ? parseInt(currentValue, 10) : 0;
        const newValue = (isNaN(currentNum) ? 0 : currentNum) + 1;
        const newEntry: KvEntry = { value: String(newValue) };
        if (expiresAt != null && !expired) {
          newEntry.expiresAt = expiresAt;
        }
        let op = kv.atomic().check(entry);
        const expireIn = newEntry.expiresAt == null ? undefined : remainingExpireIn(newEntry.expiresAt);
        if (expireIn != null) {
          op = op.set(['data', key], newEntry, { expireIn });
        } else {
          op = op.set(['data', key], newEntry);
        }
        const res = await op.commit();
        if (res.ok) {
          result = newValue;
          success = true;
        }
      }
      return result;
    },
    async expire(key: string, ttl: number): Promise<void> {
      await cleanupExpired();
      const expiresAt = ttlToExpiresAt(ttl);
      const entry = await kv.get<KvEntry>(['data', key]);
      if (entry.value != null) {
        const newEntry: KvEntry = { value: entry.value.value, expiresAt };
        await kv.set(['data', key], newEntry, { expireIn: ttlToExpireIn(ttl) });
        await addExpiryIndex({ namespace: 'data', key, expiresAt });
      }

      const ziter = kv.list<number | ZsetEntry>({ prefix: ['zset', key] });
      let hasZsetMembers = false;
      for await (const zEntry of ziter) {
        hasZsetMembers = true;
        const parsed = parseZsetEntry(zEntry.value);
        const member = String(zEntry.key[2]);
        if (parsed.expiresAt != null && parsed.expiresAt !== expiresAt) {
          await deleteExpiryIndex({ namespace: 'zset', key, member, expiresAt: parsed.expiresAt });
        }
        const newEntry: ZsetEntry = { score: parsed.score, expiresAt };
        await kv.set(zEntry.key, newEntry, { expireIn: ttlToExpireIn(ttl) });
        await addExpiryIndex({ namespace: 'zset', key, member, expiresAt });
      }
      if (hasZsetMembers) {
        await kv.set(['zset-expiry', key], { value: '1', expiresAt }, { expireIn: ttlToExpireIn(ttl) });
      }
    },
    async sadd(key: string, ...members: string[]): Promise<number> {
      await cleanupExpired();
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
      await cleanupExpired();
      const entry = await kv.get(['set', key, member]);
      return entry.value != null;
    },
    async del(...keys: string[]): Promise<number> {
      await cleanupExpired();
      let deleted = 0;
      for (const key of keys) {
        // 通常 key を削除する
        const entry = await kv.get<KvEntry>(['data', key]);
        if (entry.value != null) {
          await kv.delete(['data', key]);
          if (entry.value.expiresAt != null) {
            await deleteExpiryIndex({ namespace: 'data', key, expiresAt: entry.value.expiresAt });
          }
          deleted++;
        }
        // set member を削除する
        const iter = kv.list({ prefix: ['set', key] });
        for await (const setEntry of iter) {
          await kv.delete(setEntry.key);
        }
        // sorted set member を削除する
        const ziter = kv.list<number | ZsetEntry>({ prefix: ['zset', key] });
        for await (const zEntry of ziter) {
          const parsed = parseZsetEntry(zEntry.value);
          await deleteZsetMember(key, String(zEntry.key[2]), parsed);
        }
        await kv.delete(['zset-expiry', key]);
      }
      return deleted;
    },
    async zadd(key: string, score: number, member: string): Promise<number> {
      await cleanupExpired();
      const existing = await kv.get<number | ZsetEntry>(['zset', key, member]);
      const current = existing.value == null ? null : parseZsetEntry(existing.value);
      const entry: ZsetEntry = { score };
      if (current?.expiresAt != null && !isExpired(current.expiresAt)) {
        entry.expiresAt = current.expiresAt;
      } else {
        entry.expiresAt = await getZsetExpiresAt(key);
      }

      if (current?.expiresAt != null && current.expiresAt !== entry.expiresAt) {
        await deleteExpiryIndex({ namespace: 'zset', key, member, expiresAt: current.expiresAt });
      }

      const expireIn = entry.expiresAt == null ? undefined : remainingExpireIn(entry.expiresAt);
      if (expireIn != null) {
        await kv.set(['zset', key, member], entry, { expireIn });
        await addExpiryIndex({ namespace: 'zset', key, member, expiresAt: entry.expiresAt! });
      } else {
        await kv.set(['zset', key, member], entry);
      }
      return 1;
    },
    async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
      await cleanupExpired();
      let removed = 0;
      const iter = kv.list<number | ZsetEntry>({ prefix: ['zset', key] });
      for await (const entry of iter) {
        const parsed = parseZsetEntry(entry.value);
        const member = String(entry.key[2]);
        if (isExpired(parsed.expiresAt)) {
          await deleteZsetMember(key, member, parsed);
          continue;
        }
        if (parsed.score >= min && parsed.score <= max) {
          await deleteZsetMember(key, member, parsed);
          removed++;
        }
      }
      return removed;
    },
    async zcard(key: string): Promise<number> {
      await cleanupExpired();
      let count = 0;
      const iter = kv.list<number | ZsetEntry>({ prefix: ['zset', key] });
      for await (const entry of iter) {
        const parsed = parseZsetEntry(entry.value);
        if (isExpired(parsed.expiresAt)) {
          await deleteZsetMember(key, String(entry.key[2]), parsed);
          continue;
        }
        count++;
      }
      return count;
    },
    async slidingWindowAdd(
      key: string,
      windowStart: number,
      limit: number,
      score: number,
      member: string,
      ttl: number,
    ): Promise<boolean> {
      return await withKeyLock(key, async () => {
        await cleanupExpired();
        let count = 0;
        const iter = kv.list<number | ZsetEntry>({ prefix: ['zset', key] });
        for await (const entry of iter) {
          const parsed = parseZsetEntry(entry.value);
          if (isExpired(parsed.expiresAt) || parsed.score <= windowStart) {
            await deleteZsetMember(key, String(entry.key[2]), parsed);
            continue;
          }
          count++;
        }
        if (count >= limit) {
          return false;
        }

        const expiresAt = ttlToExpiresAt(ttl);
        const zsetEntry: ZsetEntry = { score, expiresAt };
        await kv.set(['zset', key, member], zsetEntry, { expireIn: ttlToExpireIn(ttl) });
        await addExpiryIndex({ namespace: 'zset', key, member, expiresAt });
        await kv.set(['zset-expiry', key], { value: '1', expiresAt }, { expireIn: ttlToExpireIn(ttl) });
        return true;
      });
    },
    close(): Promise<void> {
      kv.close();
      return Promise.resolve();
    },
  };
}
