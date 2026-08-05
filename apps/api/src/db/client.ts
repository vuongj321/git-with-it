import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { env } from '../config/env';

const globalForDb = globalThis as unknown as { __gwiPool?: Pool };

export const pool =
  globalForDb.__gwiPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__gwiPool = pool;
}

export const db = drizzle(pool, { schema });
