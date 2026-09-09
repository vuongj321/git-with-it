import { z } from 'zod';

const EnvSchema = z.object({
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_URL: z.string().default('http://localhost:4000'),
  AUTH_SECRET: z.string().min(16),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('gwiadmin'),
  S3_SECRET_KEY: z.string().default('gwiadmin123'),
  S3_BUCKET: z.string().default('gwi-artifacts'),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  WORKER_TMP_DIR: z.string().default('.tmp/workspaces'),
  GWI_GIT_BIN: z.string().default('gwi-git'),
  GWI_PARSE_BIN: z.string().default('gwi-parse'),
  GWI_LINK_BIN: z.string().default('gwi-link'),
  GWI_GRAPH_BIN: z.string().default('gwi-graph'),
  GWI_METRICS_BIN: z.string().default('gwi-metrics'),
  MAX_CLONE_BYTES: z.coerce.number().default(2_147_483_648),
  CLONE_TIMEOUT_MS: z.coerce.number().default(600_000),
  PAT_ENCRYPTION_KEY: z.string().default('0123456789abcdef0123456789abcdef'),
  LOG_LEVEL: z.string().default('info'),
  AI_PROVIDER: z.enum(['disabled', 'mock', 'openai', 'anthropic']).default('disabled'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('mock-grounded-v1'),
});

export const env = EnvSchema.parse({
  REDIS_URL: process.env.REDIS_URL,
  API_URL: process.env.API_URL,
  AUTH_SECRET:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    'dev-auth-secret-change-me-in-production',
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  WORKER_TMP_DIR: process.env.WORKER_TMP_DIR,
  GWI_GIT_BIN: process.env.GWI_GIT_BIN,
  GWI_PARSE_BIN: process.env.GWI_PARSE_BIN,
  GWI_LINK_BIN: process.env.GWI_LINK_BIN,
  GWI_GRAPH_BIN: process.env.GWI_GRAPH_BIN,
  GWI_METRICS_BIN: process.env.GWI_METRICS_BIN,
  MAX_CLONE_BYTES: process.env.MAX_CLONE_BYTES,
  CLONE_TIMEOUT_MS: process.env.CLONE_TIMEOUT_MS,
  PAT_ENCRYPTION_KEY: process.env.PAT_ENCRYPTION_KEY,
  LOG_LEVEL: process.env.LOG_LEVEL,
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
});
