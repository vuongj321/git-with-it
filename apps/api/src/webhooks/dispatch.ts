/**
 * Outbound org webhook dispatcher (insight.created, etc.).
 */

import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { organizations, repositories, webhookEndpoints } from '../db/schema';

export type WebhookEvent = 'insight.created';

export async function dispatchOrgWebhook(opts: {
  orgId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}): Promise<{ delivered: number; failed: number }> {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.orgId, opts.orgId),
        eq(webhookEndpoints.enabled, true),
      ),
    );

  const body = JSON.stringify({
    id: `evt_${Date.now()}`,
    type: opts.event,
    createdAt: new Date().toISOString(),
    data: opts.payload,
  });

  let delivered = 0;
  let failed = 0;

  await Promise.all(
    endpoints.map(async (ep) => {
      if (ep.events.length && !ep.events.includes(opts.event)) return;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'user-agent': 'git-with-it-webhooks/1',
        'x-gwi-event': opts.event,
      };
      if (ep.secret) {
        const sig = createHmac('sha256', ep.secret).update(body).digest('hex');
        headers['x-gwi-signature'] = `sha256=${sig}`;
      }
      try {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) delivered += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }),
  );

  return { delivered, failed };
}

export async function orgIdForRepo(repoId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: repositories.orgId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  return row?.orgId ?? null;
}

/** Ensure org row exists (for typing / future filters). */
export async function assertOrg(orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return Boolean(row);
}
