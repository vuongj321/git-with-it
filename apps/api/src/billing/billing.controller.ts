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

const CheckoutBody = z.object({
  orgId: z.string().uuid(),
  /** Team plan only for MVP Checkout */
  tier: z.enum(['team']).default('team'),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

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

  /**
   * Stripe Checkout for Team plan.
   * When STRIPE_SECRET_KEY is unset, returns a contact-sales / mock session URL.
   */
  @Post('checkout')
  async checkout(@Body() body: unknown) {
    const parsed = CheckoutBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { orgId, successUrl, cancelUrl } = parsed.data;

    await this.quotas.ensureFreeSubscription(orgId);
    const [team] = await db.select().from(plans).where(eq(plans.tier, 'team')).limit(1);
    if (!team) throw new BadRequestException('Team plan not configured');

    if (!env.STRIPE_SECRET_KEY) {
      return {
        mode: 'mock',
        message:
          'Stripe is not configured. Set STRIPE_SECRET_KEY + STRIPE_TEAM_PRICE_ID, or contact sales for Enterprise.',
        url:
          successUrl ??
          `${env.WEB_ORIGIN}/billing?orgId=${orgId}&checkout=mock-team`,
      };
    }

    // Lightweight Stripe Checkout Session via REST (no SDK dep required for MVP).
    const priceId = env.STRIPE_TEAM_PRICE_ID || team.stripePriceId;
    if (!priceId) {
      throw new BadRequestException('STRIPE_TEAM_PRICE_ID not set');
    }
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', successUrl ?? `${env.WEB_ORIGIN}/billing?success=1`);
    params.set('cancel_url', cancelUrl ?? `${env.WEB_ORIGIN}/billing?canceled=1`);
    params.set('line_items[0][price]', priceId);
    params.set('line_items[0][quantity]', '1');
    params.set('client_reference_id', orgId);
    params.set('metadata[org_id]', orgId);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(`Stripe error: ${text}`);
    }
    const session = (await res.json()) as { id: string; url: string };
    return { mode: 'stripe', id: session.id, url: session.url };
  }

  /** Dev/test helper: attach Team plan without Stripe. */
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
