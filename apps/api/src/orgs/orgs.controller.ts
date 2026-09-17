import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AcceptInviteBodySchema,
  CreateInviteBodySchema,
  CreateOrgBodySchema,
} from '@gwi/shared-types';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { OrgMembershipGuard } from '../auth/org-membership.guard';
import { OrgIdParam } from '../auth/org.decorator';
import { db } from '../db/client';
import { memberships, organizations, webhookEndpoints } from '../db/schema';
import { OrgsService } from './orgs.service';

const CreateWebhookBody = z.object({
  url: z.string().url(),
  secret: z.string().min(8).optional(),
  events: z.array(z.string().min(1)).default(['insight.created']),
});

@ApiTags('orgs')
@ApiBearerAuth()
@Controller('v1/orgs')
@UseGuards(JwtOrSessionAuthGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  async create(@Body() body: unknown, @Req() req: Request) {
    const parsed = CreateOrgBodySchema.parse(body);
    const org = await this.orgs.createTeamOrg(req.user!.userId, parsed.name, parsed.slug);
    return this.orgs.serializeOrg(org, 'owner');
  }

  @Get()
  async listMine(@Req() req: Request) {
    return this.orgs.listMine(req.user!.userId);
  }

  @Get('invites/preview')
  async previewInvite(@Query('token') token: string) {
    if (!token) throw new NotFoundException('Invite not found');
    return this.orgs.previewInvite(token);
  }

  @Post('invites/accept')
  async acceptInvite(@Body() body: unknown, @Req() req: Request) {
    const parsed = AcceptInviteBodySchema.parse(body);
    const email = req.user!.email ?? (await this.orgs.getUserEmail(req.user!.userId));
    return this.orgs.acceptInvite(parsed.token, req.user!.userId, email);
  }

  @Get('by-slug/:slug')
  async getBySlug(@Param('slug') slug: string, @Req() req: Request) {
    const rows = await db
      .select({ org: organizations })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.orgId, organizations.id))
      .where(and(eq(organizations.slug, slug), eq(memberships.userId, req.user!.userId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Organization not found');
    const membership = await this.orgs.requireMembership(row.org.id, req.user!.userId);
    return this.orgs.serializeOrg(row.org, membership.role);
  }

  @Get(':id')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async get(@Param('id') id: string, @Req() req: Request) {
    const rows = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    const org = rows[0];
    if (!org) throw new NotFoundException('Organization not found');
    const membership = await this.orgs.requireMembership(org.id, req.user!.userId);
    return this.orgs.serializeOrg(org, membership.role);
  }

  @Post(':id/invites')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async createInvite(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const parsed = CreateInviteBodySchema.parse(body);
    return this.orgs.createInvite({
      orgId: id,
      invitedByUserId: req.user!.userId,
      email: parsed.email,
      role: parsed.role,
    });
  }

  @Get(':id/invites')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async listInvites(@Param('id') id: string, @Req() req: Request) {
    return this.orgs.listInvites(id, req.user!.userId);
  }

  @Delete(':id/invites/:inviteId')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async revokeInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @Req() req: Request,
  ) {
    return this.orgs.revokeInvite(id, inviteId, req.user!.userId);
  }

  @Get(':id/webhooks')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async listWebhooks(@Param('id') id: string) {
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.orgId, id));
    return rows.map(serializeWebhook);
  }

  @Post(':id/webhooks')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async createWebhook(@Param('id') id: string, @Body() body: unknown) {
    const parsed = CreateWebhookBody.parse(body);
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        orgId: id,
        url: parsed.url,
        secret: parsed.secret ?? null,
        events: parsed.events,
      })
      .returning();
    return serializeWebhook(row!);
  }

  @Delete(':id/webhooks/:webhookId')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async deleteWebhook(
    @Param('id') id: string,
    @Param('webhookId') webhookId: string,
  ) {
    await db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.orgId, id)));
    return { ok: true, id: webhookId };
  }
}

function serializeWebhook(row: typeof webhookEndpoints.$inferSelect) {
  return {
    id: row.id,
    orgId: row.orgId,
    url: row.url,
    events: row.events,
    enabled: row.enabled,
    hasSecret: Boolean(row.secret),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
