/**
 * Per-repo Redis lease for Neo4j delta writers (ADR 0011).
 * Allows parse_commit concurrency > 1 across different repos without races.
 */

import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from './env';
import { logger } from './logger';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
  }
  return redis;
}

function lockKey(repoId: string): string {
  return `gwi:neo4j-writer:${repoId}`;
}

/**
 * Acquire an exclusive lease for `repoId`. Retries until timeout.
 * Returns a release function that only deletes if we still own the token.
 */
export async function withRepoNeo4jLock<T>(
  repoId: string,
  fn: () => Promise<T>,
  opts?: { ttlMs?: number; waitMs?: number; pollMs?: number },
): Promise<T> {
  const ttlMs = opts?.ttlMs ?? 600_000;
  const waitMs = opts?.waitMs ?? 900_000;
  const pollMs = opts?.pollMs ?? 250;
  const token = randomUUID();
  const key = lockKey(repoId);
  const r = getRedis();
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    const ok = await r.set(key, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') {
      logger.debug({ repoId }, 'acquired neo4j repo lock');
      try {
        return await fn();
      } finally {
        // Lua: delete only if token matches
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await r.eval(script, 1, key, token).catch(() => undefined);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`timed out waiting for neo4j lock on repo ${repoId}`);
}
