import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { memberships, organizations, users } from './schema';

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

  const existingOrgs = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);
  let org = existingOrgs[0];
  if (!org) {
    const inserted = await db
      .insert(organizations)
      .values({ name: orgName, slug: orgSlug })
      .returning();
    org = inserted[0]!;
    console.log(`Created org ${orgSlug}`);
  } else {
    console.log(`Org ${orgSlug} already exists`);
  }

  const existingMembership = await db
    .select()
    .from(memberships)
    .where(eq(memberships.orgId, org.id))
    .limit(1);
  const alreadyMember = existingMembership.some((m) => m.userId === user!.id);
  if (!alreadyMember) {
    await db.insert(memberships).values({
      orgId: org.id,
      userId: user.id,
      role: 'owner',
    });
    console.log(`Linked ${email} as owner of ${orgSlug}`);
  }

  await pool.end();
  console.log('Seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
