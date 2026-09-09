import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  organizations,
  plans,
  repositories,
  subscriptions,
  usageCounters,
  type Plan,
} from '../db/schema';

function currentPeriodYm(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const FREE_DEFAULTS: Pick<
  Plan,
  'maxRepos' | 'maxParseMinutesMonth' | 'maxAiCallsMonth' | 'tier' | 'name'
> = {
  tier: 'free',
  name: 'Free',
  maxRepos: 3,
  maxParseMinutesMonth: 60,
  maxAiCallsMonth: 20,
};

@Injectable()
export class QuotasService {
  async resolvePlan(orgId: string): Promise<{
    plan: typeof FREE_DEFAULTS & { id?: string; stripePriceId?: string | null };
    inGrace: boolean;
  }> {
    const [sub] = await db
      .select({
        status: subscriptions.status,
        graceUntil: subscriptions.graceUntil,
        planId: subscriptions.planId,
        tier: plans.tier,
        name: plans.name,
        maxRepos: plans.maxRepos,
        maxParseMinutesMonth: plans.maxParseMinutesMonth,
        maxAiCallsMonth: plans.maxAiCallsMonth,
        stripePriceId: plans.stripePriceId,
        id: plans.id,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.orgId, orgId))
      .limit(1);

    if (!sub) {
      const [free] = await db.select().from(plans).where(eq(plans.tier, 'free')).limit(1);
      return {
        plan: free
          ? {
              id: free.id,
              tier: free.tier,
              name: free.name,
              maxRepos: free.maxRepos,
              maxParseMinutesMonth: free.maxParseMinutesMonth,
              maxAiCallsMonth: free.maxAiCallsMonth,
              stripePriceId: free.stripePriceId,
            }
          : FREE_DEFAULTS,
        inGrace: true,
      };
    }

    const active = sub.status === 'active' || sub.status === 'trialing';
    const inGrace =
      active ||
      (!!sub.graceUntil && sub.graceUntil.getTime() > Date.now());

    return {
      plan: {
        id: sub.id,
        tier: sub.tier,
        name: sub.name,
        maxRepos: sub.maxRepos,
        maxParseMinutesMonth: sub.maxParseMinutesMonth,
        maxAiCallsMonth: sub.maxAiCallsMonth,
        stripePriceId: sub.stripePriceId,
      },
      inGrace,
    };
  }

  async getUsage(orgId: string, periodYm = currentPeriodYm()) {
    const [row] = await db
      .select()
      .from(usageCounters)
      .where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.periodYm, periodYm)))
      .limit(1);
    return (
      row ?? {
        orgId,
        periodYm,
        repos: 0,
        parseMinutes: 0,
        aiCalls: 0,
      }
    );
  }

  private async ensureUsageRow(orgId: string, periodYm: string) {
    await db
      .insert(usageCounters)
      .values({ orgId, periodYm, repos: 0, parseMinutes: 0, aiCalls: 0 })
      .onConflictDoNothing();
  }

  async assertCanAddRepo(orgId: string) {
    const { plan, inGrace } = await this.resolvePlan(orgId);
    if (!inGrace) {
      throw new ForbiddenException('Subscription inactive; upgrade or contact sales');
    }
    const [{ value } = { value: 0 }] = await db
      .select({ value: count() })
      .from(repositories)
      .where(eq(repositories.orgId, orgId));
    if (Number(value) >= plan.maxRepos) {
      throw new ForbiddenException(
        `Repo quota exceeded (${plan.maxRepos} on ${plan.name} plan)`,
      );
    }
  }

  async assertCanAnalyze(orgId: string) {
    const { plan, inGrace } = await this.resolvePlan(orgId);
    if (!inGrace) {
      throw new ForbiddenException('Subscription inactive; cannot start analysis');
    }
    const usage = await this.getUsage(orgId);
    if (usage.parseMinutes >= plan.maxParseMinutesMonth) {
      throw new ForbiddenException(
        `Parse minutes quota exceeded (${plan.maxParseMinutesMonth}/mo on ${plan.name})`,
      );
    }
  }

  async assertCanEnqueueAi(orgId: string) {
    const { plan, inGrace } = await this.resolvePlan(orgId);
    if (!inGrace) {
      throw new ForbiddenException('Subscription inactive; cannot enqueue AI');
    }
    const usage = await this.getUsage(orgId);
    if (usage.aiCalls >= plan.maxAiCallsMonth) {
      throw new ForbiddenException(
        `AI call quota exceeded (${plan.maxAiCallsMonth}/mo on ${plan.name})`,
      );
    }
  }

  async recordAiCall(orgId: string, n = 1) {
    const periodYm = currentPeriodYm();
    await this.ensureUsageRow(orgId, periodYm);
    await db
      .update(usageCounters)
      .set({
        aiCalls: sql`${usageCounters.aiCalls} + ${n}`,
        updatedAt: new Date(),
      })
      .where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.periodYm, periodYm)));
  }

  async recordParseMinutes(orgId: string, minutes: number) {
    if (minutes <= 0) return;
    const periodYm = currentPeriodYm();
    await this.ensureUsageRow(orgId, periodYm);
    await db
      .update(usageCounters)
      .set({
        parseMinutes: sql`${usageCounters.parseMinutes} + ${Math.ceil(minutes)}`,
        updatedAt: new Date(),
      })
      .where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.periodYm, periodYm)));
  }

  async ensureFreeSubscription(orgId: string) {
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId))
      .limit(1);
    if (existing) return existing;
    const [free] = await db.select().from(plans).where(eq(plans.tier, 'free')).limit(1);
    if (!free) {
      throw new ServiceUnavailableException('plans table not seeded; run migrations');
    }
    const [created] = await db
      .insert(subscriptions)
      .values({
        orgId,
        planId: free.id,
        status: 'active',
      })
      .returning();
    return created!;
  }

  async orgFeatures(orgId: string): Promise<Record<string, unknown>> {
    const [org] = await db
      .select({ features: organizations.features })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return (org?.features as Record<string, unknown>) ?? {};
  }
}
