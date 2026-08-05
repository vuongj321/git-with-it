import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgresql://gwi:gwi@localhost:5432/gwi';
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  const migrationsFolder = path.join(__dirname, '../../drizzle');
  console.log(`Migrating with DATABASE_URL host…`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations complete');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
