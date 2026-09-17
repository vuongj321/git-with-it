import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { OrgMembershipGuard } from '../auth/org-membership.guard';
import { env } from '../config/env';
import { db } from '../db/client';
import { plans, subscriptions } from '../db/schema';
import { QuotasService } from './quotas.service';

@Controller('v1/billing')
@UseGuards(JwtOrSessionAuthGuard, OrgMembershipGuard)
export class BillingController {
  constructor(private readonly quotas: QuotasService) {}

  @Get('usage')
  async usage(@Query('orgId') orgId: string) {
    await this.quotas.ensureFreeSubscription(orgId);
    const { plan } = await this.quotas.resolvePlan(orgId);
    const usage = await this.quotas.getUsage(orgId);
    return {
      plan,
      usage: {
        periodYm: usage.periodYm,
        repos: usage.repos,
        parseMinutes: usage.parseMinutes,
        aiCalls: usage.aiCalls,
      },
      limits: {
        maxRepos: plan.maxRepos,
        maxParseMinutesMonth: plan.maxParseMinutesMonth,
        maxAiCallsMonth: plan.maxAiCallsMonth,
      },
    };
  }

  /** Dev/test helper: attach Team plan without a payment provider. */
  @Post('dev/attach-team')
  async attachTeam(@Body() body: unknown) {
    if (env.NODE_ENV === 'production') {
      throw new BadRequestException('Not available in production');
    }
    const parsed = z.object({ orgId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const [team] = await db.select().from(plans).where(eq(plans.tier, 'team')).limit(1);
    if (!team) throw new BadRequestException('Team plan missing');
    await this.quotas.ensureFreeSubscription(parsed.data.orgId);
    await db
      .update(subscriptions)
      .set({ planId: team.id, status: 'active', updatedAt: new Date() })
      .where(eq(subscriptions.orgId, parsed.data.orgId));
    return { ok: true, tier: 'team' };
  }
}
