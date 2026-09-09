import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Load monorepo-root `.env` when nest/turbo cwd is `apps/api` (does not override existing env). */
function loadRootEnvFile() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    break;
  }
}

loadRootEnvFile();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(16),
  LOG_LEVEL: z.string().default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),
  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('gwi-local-dev'),
  CLICKHOUSE_URL: z.string().default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().default('default'),
  // Must match infra/docker-compose.yml (empty password disables network auth in the image).
  CLICKHOUSE_PASSWORD: z.string().default('gwi'),
  CLICKHOUSE_DATABASE: z.string().default('default'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('gwiadmin'),
  S3_SECRET_KEY: z.string().default('gwiadmin123'),
  S3_BUCKET: z.string().default('gwi-artifacts'),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://gwi:gwi@localhost:5432/gwi',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    API_PORT: process.env.API_PORT ?? '4000',
    WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    AUTH_SECRET:
      process.env.AUTH_SECRET ??
      process.env.NEXTAUTH_SECRET ??
      'dev-auth-secret-change-me-in-production',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
    NEO4J_URI: process.env.NEO4J_URI,
    NEO4J_USER: process.env.NEO4J_USER,
    NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
    CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
    CLICKHOUSE_USER: process.env.CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  });
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    throw new Error('Invalid API environment');
  }
  return parsed.data;
}

export const env = loadEnv();
