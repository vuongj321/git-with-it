import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { memberships, organizations, plans, subscriptions, users } from './schema';

async function ensureFreePlan(
  db: ReturnType<typeof drizzle>,
  orgId: string,
  label: string,
) {
  try {
    const [free] = await db.select().from(plans).where(eq(plans.tier, 'free')).limit(1);
    if (!free) return;
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId))
      .limit(1);
    if (!sub) {
      await db.insert(subscriptions).values({
        orgId,
        planId: free.id,
        status: 'active',
      });
      console.log(`Attached Free plan to ${label}`);
    }
  } catch (err) {
    console.warn(
      'Skipping plan seed (run db:migrate for Phase 5):',
      err instanceof Error ? err.message : err,
    );
  }
}

async function ensureMembership(
  db: ReturnType<typeof drizzle>,
  orgId: string,
  userId: string,
  email: string,
  orgSlug: string,
) {
  const existing = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  if (!existing[0]) {
    await db.insert(memberships).values({
      orgId,
      userId,
      role: 'owner',
    });
    console.log(`Linked ${email} as owner of ${orgSlug}`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgresql://gwi:gwi@localhost:5432/gwi';
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@git-with-it.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234';
  const orgSlug = process.env.SEED_ORG_SLUG ?? 'demo';
  const orgName = process.env.SEED_ORG_NAME ?? 'Demo Org';

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  const existingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let user = existingUsers[0];
  if (!user) {
    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await db
      .insert(users)
      .values({ email, name: 'Admin', passwordHash })
      .returning();
    user = inserted[0]!;
    console.log(`Created user ${email}`);
  } else {
    console.log(`User ${email} already exists`);
  }

  // Personal workspace for the admin (individual tenant).
  const personalSlug = `u-${user.id.replace(/-/g, '').slice(0, 12)}`;
  const existingPersonal = await db
    .select({ org: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, user.id), eq(organizations.kind, 'personal')))
    .limit(1);

  let personal = existingPersonal[0]?.org;
  if (!personal) {
    const [bySlug] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, personalSlug))
      .limit(1);
    if (bySlug) {
      personal = bySlug;
    } else {
      const inserted = await db
        .insert(organizations)
        .values({
          name: "Admin's workspace",
          slug: personalSlug,
          kind: 'personal',
        })
        .returning();
      personal = inserted[0]!;
      console.log(`Created personal workspace ${personalSlug}`);
    }
  } else {
    console.log(`Personal workspace ${personal.slug} already exists`);
  }
  await ensureMembership(db, personal.id, user.id, email, personal.slug);
  await ensureFreePlan(db, personal.id, personal.slug);

  // Demo team org for shared analysis / invite testing.
  const existingOrgs = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);
  let team = existingOrgs[0];
  if (!team) {
    const inserted = await db
      .insert(organizations)
      .values({ name: orgName, slug: orgSlug, kind: 'team' })
      .returning();
    team = inserted[0]!;
    console.log(`Created team org ${orgSlug}`);
  } else {
    if (team.kind !== 'team') {
      await db
        .update(organizations)
        .set({ kind: 'team', updatedAt: new Date() })
        .where(eq(organizations.id, team.id));
      console.log(`Updated ${orgSlug} kind to team`);
    } else {
      console.log(`Team org ${orgSlug} already exists`);
    }
  }
  await ensureMembership(db, team.id, user.id, email, orgSlug);
  await ensureFreePlan(db, team.id, orgSlug);

  await pool.end();
  console.log('Seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
