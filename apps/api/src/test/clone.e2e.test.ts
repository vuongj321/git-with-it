/**
 * Compose integration smoke for Phase 0 clone E2E.
 *
 * Prerequisites: `make up`, migrated+seeded DB, API + worker running.
 *
 *   pnpm --filter @gwi/api exec vitest run src/test/clone.e2e.test.ts
 *
 * In CI this is intended to run as a Compose service job once Docker is available.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const AUTH_SECRET =
  process.env.AUTH_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  'dev-auth-secret-change-me-in-production';
const RUN_E2E = process.env.GWI_E2E === '1';

function serviceToken() {
  return createHash('sha256').update(`gwi-service:${AUTH_SECRET}`).digest('hex');
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (!headers.has('authorization')) {
    headers.set('authorization', `Bearer ${serviceToken()}`);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return JSON.parse(text) as T;
}

describe.skipIf(!RUN_E2E)('clone e2e', () => {
  it(
    'registers a public repo, clones, and marks run ready',
    async () => {
      const health = await api<{ status: string }>('/health');
      expect(health.status).toBe('ok');

      // Service token bypasses membership; create org via login seed path instead.
      const login = await api<{ accessToken: string; user: { id: string } }>(
        '/v1/auth/login',
        {
          method: 'POST',
          headers: { authorization: '' },
          body: JSON.stringify({
            email: process.env.SEED_ADMIN_EMAIL ?? 'admin@git-with-it.local',
            password: process.env.SEED_ADMIN_PASSWORD ?? 'admin1234',
          }),
        },
      );

      const orgs = await api<Array<{ id: string; slug: string }>>('/v1/orgs', {
        headers: { authorization: `Bearer ${login.accessToken}` },
      });
      const org = orgs[0];
      expect(org).toBeTruthy();

      const remoteUrl =
        process.env.GWI_E2E_REMOTE_URL ?? 'https://github.com/octocat/Hello-World.git';
      const defaultBranch = process.env.GWI_E2E_BRANCH ?? 'master';

      const repo = await api<{ id: string }>(
        '/v1/repos',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${login.accessToken}` },
          body: JSON.stringify({
            orgId: org!.id,
            remoteUrl,
            defaultBranch,
          }),
        },
      );

      const analyzed = await api<{ run: { id: string } }>(
        `/v1/repos/${repo.id}/analyze?orgId=${org!.id}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${login.accessToken}` },
          body: JSON.stringify({}),
        },
      );

      const deadline = Date.now() + 180_000;
      let status = 'queued';
      let cloneUri: string | null = null;
      while (Date.now() < deadline) {
        const run = await api<{ status: string }>(
          `/v1/repos/${repo.id}/runs/${analyzed.run.id}?orgId=${org!.id}`,
          { headers: { authorization: `Bearer ${login.accessToken}` } },
        );
        status = run.status;
        if (status === 'ready' || status === 'failed') {
          const fresh = await api<{ cloneUri: string | null; lastError: string | null }>(
            `/v1/repos/${repo.id}?orgId=${org!.id}`,
            { headers: { authorization: `Bearer ${login.accessToken}` } },
          );
          cloneUri = fresh.cloneUri;
          if (status === 'failed') {
            throw new Error(fresh.lastError ?? 'clone failed');
          }
          break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }

      expect(status).toBe('ready');
      expect(cloneUri).toMatch(/^s3:\/\//);
    },
    200_000,
  );
});
