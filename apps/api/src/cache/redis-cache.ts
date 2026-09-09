import Redis from 'ioredis';
import { env } from '../config/env';

let redis: Redis | null = null;

export function getRedisCache(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    redis.on('error', () => {
      // best-effort cache; avoid crashing the API
    });
  }
  return redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedisCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  try {
    await getRedisCache().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // cache is best-effort
  }
}

export async function invalidateRepoCaches(repoId: string) {
  try {
    const r = getRedisCache();
    const patterns = [`graph:${repoId}:*`, `metrics:${repoId}:*`];
    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length) await r.del(...keys);
      } while (cursor !== '0');
    }
  } catch {
    // ignore
  }
}

/** Blueprint §17 cache keys */
export function graphCacheKey(
  repoId: string,
  sha: string,
  view: string,
  focus: string,
  depth: string,
) {
  return `graph:${repoId}:${sha}:${view}:${focus}:${depth}`;
}

export function metricsCacheKey(
  repoId: string,
  entity: string,
  metric: string,
  range: string,
) {
  return `metrics:${repoId}:${entity}:${metric}:${range}`;
}
