#!/usr/bin/env node
/**
 * Lightweight API load probe (Node built-ins only).
 *
 *   pnpm load-test
 *   API_URL=http://localhost:4000 LOAD_TEST_CONCURRENCY=20 LOAD_TEST_REQUESTS=200 pnpm load-test
 */

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const CONCURRENCY = Math.max(1, Number(process.env.LOAD_TEST_CONCURRENCY ?? 10));
const REQUESTS = Math.max(1, Number(process.env.LOAD_TEST_REQUESTS ?? 50));
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@git-with-it.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234';
const ERROR_RATE_LIMIT = 0.05;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function main() {
  const healthRes = await fetch(`${API_URL}/health`);
  if (!healthRes.ok) {
    console.error(`Health check failed: ${healthRes.status}`);
    process.exit(1);
  }
  const health = await readJson(healthRes);
  if (!health || health.status !== 'ok') {
    console.error('Health check failed: unexpected body', health);
    process.exit(1);
  }
  console.log(`Health OK (${API_URL}/health)`);

  let authHeader = null;
  try {
    const loginRes = await fetch(`${API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (loginRes.ok) {
      const body = await readJson(loginRes);
      if (body?.accessToken) {
        authHeader = `Bearer ${body.accessToken}`;
        console.log('Authenticated via /v1/auth/login');
      }
    } else {
      console.warn(`Login skipped/failed (${loginRes.status}); continuing without auth`);
    }
  } catch (err) {
    console.warn(`Login error; continuing without auth: ${err instanceof Error ? err.message : String(err)}`);
  }

  const latencies = [];
  let errors = 0;
  let completed = 0;
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= REQUESTS) return;
      const started = performance.now();
      try {
        const headers = {};
        if (authHeader) headers.authorization = authHeader;
        const res = await fetch(`${API_URL}/v1/orgs`, { headers });
        const ms = performance.now() - started;
        latencies.push(ms);
        if (!res.ok) errors += 1;
      } catch {
        latencies.push(performance.now() - started);
        errors += 1;
      }
      completed += 1;
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, () => worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const errorRate = errors / REQUESTS;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  console.log(
    JSON.stringify(
      {
        requests: REQUESTS,
        concurrency: CONCURRENCY,
        completed,
        errors,
        errorRate: Number(errorRate.toFixed(4)),
        p50_ms: Math.round(p50),
        p95_ms: Math.round(p95),
      },
      null,
      2,
    ),
  );

  if (errorRate > ERROR_RATE_LIMIT) {
    console.error(`Error rate ${(errorRate * 100).toFixed(1)}% exceeds ${(ERROR_RATE_LIMIT * 100).toFixed(0)}% threshold`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
