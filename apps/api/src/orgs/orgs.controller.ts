import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateOrgBodySchema } from '@gwi/shared-types';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { OrgMembershipGuard } from '../auth/org-membership.guard';
import { OrgIdParam } from '../auth/org.decorator';
import { db } from '../db/client';
import { memberships, organizations } from '../db/schema';

@ApiTags('orgs')
@ApiBearerAuth()
@Controller('v1/orgs')
@UseGuards(JwtOrSessionAuthGuard)
export class OrgsController {
  @Post()
  async create(@Body() body: unknown, @Req() req: Request) {
    const parsed = CreateOrgBodySchema.parse(body);
    const [org] = await db
      .insert(organizations)
      .values({ name: parsed.name, slug: parsed.slug })
      .returning();
    await db.insert(memberships).values({
      orgId: org!.id,
      userId: req.user!.userId,
      role: 'owner',
    });
    return serializeOrg(org!);
  }

  @Get()
  async listMine(@Req() req: Request) {
    const rows = await db
      .select({ org: organizations })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, req.user!.userId));
    return rows.map((r) => serializeOrg(r.org));
  }

  @Get(':id')
  @OrgIdParam('id')
  @UseGuards(OrgMembershipGuard)
  async get(@Param('id') id: string) {
    const rows = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    const org = rows[0];
    if (!org) throw new NotFoundException('Organization not found');
    return serializeOrg(org);
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
    return serializeOrg(row.org);
  }
}

function serializeOrg(org: typeof organizations.$inferSelect) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt.toISOString(),
  };
}
