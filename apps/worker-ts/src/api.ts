import { createHash } from 'node:crypto';
import { env } from './env';

export function serviceToken() {
  return createHash('sha256').update(`gwi-service:${env.AUTH_SECRET}`).digest('hex');
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out.length ? out : [[]];
}

export async function apiJson<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${serviceToken()}`);
  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${env.API_URL}${path}`, {
    method: init.method,
    headers,
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function patchRun(runId: string, body: Record<string, unknown>) {
  await apiJson(`/v1/internal/runs/${runId}`, { method: 'PATCH', body });
}
