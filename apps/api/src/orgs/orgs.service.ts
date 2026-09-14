import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { QuotasService } from '../billing/quotas.service';
import { env } from '../config/env';
import { db } from '../db/client';
import {
  memberships,
  orgInvites,
  organizations,
  users,
  type Membership,
  type OrgInvite,
  type Organization,
} from '../db/schema';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function personalSlugForUser(userId: string): string {
  return `u-${userId.replace(/-/g, '').slice(0, 12)}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

function serializeOrg(org: Organization, role?: Membership['role']) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    kind: org.kind,
    createdAt: org.createdAt.toISOString(),
    ...(role ? { role } : {}),
  };
}

@Injectable()
export class OrgsService {
  constructor(private readonly quotas: QuotasService) {}

  serializeOrg = serializeOrg;

  async findPersonalOrg(userId: string): Promise<Organization | null> {
    const rows = await db
      .select({ org: organizations })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, userId), eq(organizations.kind, 'personal')))
      .limit(1);
    return rows[0]?.org ?? null;
  }

  async provisionPersonalWorkspace(
    userId: string,
    opts?: { email?: string; name?: string | null },
  ): Promise<Organization> {
    const existing = await this.findPersonalOrg(userId);
    if (existing) return existing;

    const local =
      opts?.name?.trim() ||
      (opts?.email ? opts.email.split('@')[0] : null) ||
      'Personal';
    const name = `${local}'s workspace`.slice(0, 120);
    let slug = personalSlugForUser(userId);
    const clash = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (clash[0]) {
      slug = `${slug}-${randomBytes(2).toString('hex')}`;
    }

    const [org] = await db
      .insert(organizations)
      .values({ name, slug, kind: 'personal' })
      .returning();
    await db.insert(memberships).values({
      orgId: org!.id,
      userId,
      role: 'owner',
    });
    await this.quotas.ensureFreeSubscription(org!.id);
    return org!;
  }

  async createTeamOrg(userId: string, name: string, slug: string): Promise<Organization> {
    const [org] = await db
      .insert(organizations)
      .values({ name, slug, kind: 'team' })
      .returning();
    await db.insert(memberships).values({
      orgId: org!.id,
      userId,
      role: 'owner',
    });
    await this.quotas.ensureFreeSubscription(org!.id);
    return org!;
  }

  async listMine(userId: string) {
    const rows = await db
      .select({ org: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId));
    return rows.map((r) => serializeOrg(r.org, r.role));
  }

  async requireMembership(orgId: string, userId: string): Promise<Membership> {
    const [row] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1);
    if (!row) throw new ForbiddenException('Not a member of this organization');
    return row;
  }

  async requireTeamAdmin(orgId: string, userId: string): Promise<{ org: Organization; membership: Membership }> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) throw new NotFoundException('Organization not found');
    if (org.kind !== 'team') {
      throw new ForbiddenException('Invites are only available for team organizations');
    }
    const membership = await this.requireMembership(orgId, userId);
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw new ForbiddenException('Only owners and admins can manage invites');
    }
    return { org, membership };
  }

  acceptUrl(token: string): string {
    return `${env.WEB_ORIGIN.replace(/\/$/, '')}/invite/${token}`;
  }

  async createInvite(input: {
    orgId: string;
    invitedByUserId: string;
    email: string;
    role: 'admin' | 'member';
  }) {
    await this.requireTeamAdmin(input.orgId, input.invitedByUserId);
    const email = normalizeEmail(input.email);

    const pending = await db
      .select()
      .from(orgInvites)
      .where(
        and(
          eq(orgInvites.orgId, input.orgId),
          eq(orgInvites.email, email),
          eq(orgInvites.status, 'pending'),
        ),
      );
    for (const row of pending) {
      await db
        .update(orgInvites)
        .set({ status: 'revoked' })
        .where(eq(orgInvites.id, row.id));
    }

    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const [invite] = await db
      .insert(orgInvites)
      .values({
        orgId: input.orgId,
        email,
        role: input.role,
        token,
        invitedByUserId: input.invitedByUserId,
        status: 'pending',
        expiresAt,
      })
      .returning();

    return this.serializeInviteCreated(invite!);
  }

  serializeInviteCreated(invite: OrgInvite) {
    return {
      id: invite.id,
      orgId: invite.orgId,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
      acceptUrl: this.acceptUrl(invite.token),
      createdAt: invite.createdAt.toISOString(),
    };
  }

  serializeInviteListItem(invite: OrgInvite) {
    return {
      id: invite.id,
      orgId: invite.orgId,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt?.toISOString() ?? null,
      createdAt: invite.createdAt.toISOString(),
    };
  }

  async listInvites(orgId: string, userId: string) {
    await this.requireTeamAdmin(orgId, userId);
    const rows = await db.select().from(orgInvites).where(eq(orgInvites.orgId, orgId));
    return rows.map((r) => this.serializeInviteListItem(r));
  }

  async revokeInvite(orgId: string, inviteId: string, userId: string) {
    await this.requireTeamAdmin(orgId, userId);
    const [invite] = await db
      .select()
      .from(orgInvites)
      .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.orgId, orgId)))
      .limit(1);
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== 'pending') {
      throw new BadRequestException('Only pending invites can be revoked');
    }
    await db.update(orgInvites).set({ status: 'revoked' }).where(eq(orgInvites.id, inviteId));
    return { ok: true, id: inviteId };
  }

  async previewInvite(token: string) {
    const invite = await this.loadInviteByToken(token);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, invite.orgId))
      .limit(1);
    if (!org || org.kind !== 'team') throw new NotFoundException('Invite not found');
    return {
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async loadInviteByToken(token: string): Promise<OrgInvite> {
    const [invite] = await db.select().from(orgInvites).where(eq(orgInvites.token, token)).limit(1);
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status === 'pending' && invite.expiresAt.getTime() < Date.now()) {
      await db.update(orgInvites).set({ status: 'expired' }).where(eq(orgInvites.id, invite.id));
      throw new BadRequestException('Invite has expired');
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException(`Invite is ${invite.status}`);
    }
    return invite;
  }

  /**
   * Accept a pending team invite for the authenticated user.
   * Email on the session must match the invite (case-insensitive).
   */
  async acceptInvite(token: string, userId: string, userEmail: string) {
    const invite = await this.loadInviteByToken(token);
    if (normalizeEmail(userEmail) !== normalizeEmail(invite.email)) {
      throw new ForbiddenException('Invite email does not match your account');
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, invite.orgId))
      .limit(1);
    if (!org || org.kind !== 'team') {
      throw new BadRequestException('Invite target is not a team organization');
    }

    const [existing] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, userId)))
      .limit(1);

    if (!existing) {
      const role = invite.role === 'admin' ? 'admin' : 'member';
      await db.insert(memberships).values({
        orgId: org.id,
        userId,
        role,
      });
    }

    await db
      .update(orgInvites)
      .set({
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedByUserId: userId,
      })
      .where(eq(orgInvites.id, invite.id));

    return serializeOrg(org, existing?.role ?? (invite.role === 'admin' ? 'admin' : 'member'));
  }

  async getUserEmail(userId: string): Promise<string> {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException('User not found');
    return user.email;
  }
}
