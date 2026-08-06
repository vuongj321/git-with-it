import { z } from 'zod';

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
  });
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    throw new Error('Invalid API environment');
  }
  return parsed.data;
}

export const env = loadEnv();
