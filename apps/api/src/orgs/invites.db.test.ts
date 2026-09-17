/**
 * Integration-style checks for register + personal workspace + invite accept.
 * Skips when DATABASE_URL is unreachable (CI without PG).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { QuotasService } from '../billing/quotas.service';
import { registerUser } from '../auth/register-user';
import { db as appDb } from '../db/client';
import {
  memberships,
  orgInvites,
  organizations,
  plans,
  subscriptions,
  users,
} from '../db/schema';
import { OrgsService, newInviteToken } from './orgs.service';

const url = process.env.DATABASE_URL ?? 'postgresql://gwi:gwi@localhost:5432/gwi';

describe('personal workspace + invites (db)', () => {
  let pool: Pool | null = null;
  let db: ReturnType<typeof drizzle> | null = null;
  let skip = false;
  let orgs: OrgsService | null = null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    try {
      await pool.query('select 1');
      db = drizzle(pool);
      // kind column from migration 0007
      await pool.query(`select kind from organizations limit 1`);
      orgs = new OrgsService(new QuotasService());
    } catch {
      skip = true;
      await pool.end().catch(() => undefined);
      pool = null;
      db = null;
      orgs = null;
    }
  });

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
  });

  it('provisions personal org and accepts team invite', async () => {
    if (skip || !db || !pool) return;

    const suffix = randomBytes(4).toString('hex');
    const ownerEmail = `owner-${suffix}@git-with-it.local`;
    const memberEmail = `member-${suffix}@git-with-it.local`;
    const passwordHash = await bcrypt.hash('password1234', 10);

    const [owner] = await db
      .insert(users)
      .values({ email: ownerEmail, name: 'Owner', passwordHash })
      .returning();
    const [member] = await db
      .insert(users)
      .values({ email: memberEmail, name: 'Member', passwordHash })
      .returning();

    const personalSlug = `u-${owner!.id.replace(/-/g, '').slice(0, 12)}`;
    const [personal] = await db
      .insert(organizations)
      .values({
        name: "Owner's workspace",
        slug: personalSlug,
        kind: 'personal',
      })
      .returning();
    await db.insert(memberships).values({
      orgId: personal!.id,
      userId: owner!.id,
      role: 'owner',
    });

    const teamSlug = `team-${suffix}`;
    const [team] = await db
      .insert(organizations)
      .values({ name: 'Invite Team', slug: teamSlug, kind: 'team' })
      .returning();
    await db.insert(memberships).values({
      orgId: team!.id,
      userId: owner!.id,
      role: 'owner',
    });

    const [free] = await db.select().from(plans).where(eq(plans.tier, 'free')).limit(1);
    if (free) {
      await db.insert(subscriptions).values({
        orgId: personal!.id,
        planId: free.id,
        status: 'active',
      });
      await db.insert(subscriptions).values({
        orgId: team!.id,
        planId: free.id,
        status: 'active',
      });
    }

    const token = randomBytes(32).toString('base64url');
    const [invite] = await db
      .insert(orgInvites)
      .values({
        orgId: team!.id,
        email: memberEmail,
        role: 'member',
        token,
        invitedByUserId: owner!.id,
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();

    // Simulate accept
    await db.insert(memberships).values({
      orgId: team!.id,
      userId: member!.id,
      role: 'member',
    });
    await db
      .update(orgInvites)
      .set({
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedByUserId: member!.id,
      })
      .where(eq(orgInvites.id, invite!.id));

    const memberOrgs = await db
      .select({ org: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, member!.id));

    expect(memberOrgs.some((r) => r.org.id === team!.id && r.role === 'member')).toBe(true);

    const ownerPersonal = await db
      .select({ org: organizations })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, owner!.id), eq(organizations.kind, 'personal')))
      .limit(1);
    expect(ownerPersonal[0]?.org.slug).toBe(personalSlug);

    // cleanup
    await db.delete(orgInvites).where(eq(orgInvites.orgId, team!.id));
    await db.delete(memberships).where(eq(memberships.orgId, team!.id));
    await db.delete(memberships).where(eq(memberships.orgId, personal!.id));
    await db.delete(subscriptions).where(eq(subscriptions.orgId, team!.id));
    await db.delete(subscriptions).where(eq(subscriptions.orgId, personal!.id));
    await db.delete(organizations).where(eq(organizations.id, team!.id));
    await db.delete(organizations).where(eq(organizations.id, personal!.id));
    await db.delete(users).where(eq(users.id, owner!.id));
    await db.delete(users).where(eq(users.id, member!.id));
  });

  it('createInvite bulk-revokes prior pending invites for same email', async () => {
    if (skip || !db || !orgs) return;

    const suffix = randomBytes(4).toString('hex');
    const ownerEmail = `invite-owner-${suffix}@git-with-it.local`;
    const inviteEmail = `invitee-${suffix}@git-with-it.local`;
    const passwordHash = await bcrypt.hash('password1234', 10);

    const [owner] = await db
      .insert(users)
      .values({ email: ownerEmail, name: 'Owner', passwordHash })
      .returning();

    const [team] = await db
      .insert(organizations)
      .values({ name: 'Bulk Revoke Team', slug: `bulk-${suffix}`, kind: 'team' })
      .returning();
    await db.insert(memberships).values({
      orgId: team!.id,
      userId: owner!.id,
      role: 'owner',
    });

    const expiresAt = new Date(Date.now() + 86_400_000);
    const oldIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [row] = await db
        .insert(orgInvites)
        .values({
          orgId: team!.id,
          email: inviteEmail,
          role: 'member',
          token: newInviteToken(),
          invitedByUserId: owner!.id,
          status: 'pending',
          expiresAt,
        })
        .returning();
      oldIds.push(row!.id);
    }

    const created = await orgs.createInvite({
      orgId: team!.id,
      invitedByUserId: owner!.id,
      email: inviteEmail,
      role: 'member',
    });

    const rows = await db.select().from(orgInvites).where(eq(orgInvites.orgId, team!.id));
    const pending = rows.filter((r) => r.status === 'pending');
    const revoked = rows.filter((r) => r.status === 'revoked');

    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(created.id);
    expect(revoked.map((r) => r.id).sort()).toEqual([...oldIds].sort());

    await db.delete(orgInvites).where(eq(orgInvites.orgId, team!.id));
    await db.delete(memberships).where(eq(memberships.orgId, team!.id));
    await db.delete(organizations).where(eq(organizations.id, team!.id));
    await db.delete(users).where(eq(users.id, owner!.id));
  });

  it('registerUser rolls back when invite token is invalid', async () => {
    if (skip || !orgs) return;

    const suffix = randomBytes(4).toString('hex');
    const email = `rollback-${suffix}@git-with-it.local`;

    await expect(
      registerUser(orgs, {
        email,
        password: 'password1234',
        name: 'Rollback',
        inviteToken: 'not-a-real-invite-token',
      }),
    ).rejects.toThrow();

    const leftover = await appDb.select().from(users).where(eq(users.email, email)).limit(1);
    expect(leftover).toHaveLength(0);
  });

  it('registerUser rolls back when invite fails inside the transaction', async () => {
    if (skip || !db || !orgs) return;

    const suffix = randomBytes(4).toString('hex');
    const ownerEmail = `tx-owner-${suffix}@git-with-it.local`;
    const memberEmail = `tx-member-${suffix}@git-with-it.local`;
    const passwordHash = await bcrypt.hash('password1234', 10);

    const [owner] = await db
      .insert(users)
      .values({ email: ownerEmail, name: 'Owner', passwordHash })
      .returning();

    // Pending invite that passes pre-check but fails accept (personal org, not team).
    const [personal] = await db
      .insert(organizations)
      .values({ name: 'Not A Team', slug: `tx-personal-${suffix}`, kind: 'personal' })
      .returning();
    await db.insert(memberships).values({
      orgId: personal!.id,
      userId: owner!.id,
      role: 'owner',
    });

    const token = newInviteToken();
    await db.insert(orgInvites).values({
      orgId: personal!.id,
      email: memberEmail,
      role: 'member',
      token,
      invitedByUserId: owner!.id,
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(
      registerUser(orgs, {
        email: memberEmail,
        password: 'password1234',
        name: 'Member',
        inviteToken: token,
      }),
    ).rejects.toThrow(/not a team/i);

    const leftover = await appDb.select().from(users).where(eq(users.email, memberEmail)).limit(1);
    expect(leftover).toHaveLength(0);

    await db.delete(orgInvites).where(eq(orgInvites.orgId, personal!.id));
    await db.delete(memberships).where(eq(memberships.orgId, personal!.id));
    await db.delete(organizations).where(eq(organizations.id, personal!.id));
    await db.delete(users).where(eq(users.id, owner!.id));
  });
});
