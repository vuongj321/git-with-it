import { Worker } from 'bullmq';
import {
  AiGenerateJobPayloadSchema,
  CloneJobPayloadSchema,
  EnumerateSampleJobPayloadSchema,
  EvolveJobPayloadSchema,
  MetricsWriteJobPayloadSchema,
  ParseCommitJobPayloadSchema,
} from '@gwi/shared-types';
import { processAiGenerateJob } from './ai';
import { processCloneJob } from './clone';
import { processEnumerateSampleJob } from './enumerate';
import { env } from './env';
import { processEvolveJob } from './evolve';
import { logger } from './logger';
import { processMetricsWriteJob } from './metrics-write';
import { processParseCommitJob } from './parse-commit';

logger.info(
  { ai_provider: env.AI_PROVIDER, ai_model: env.AI_MODEL },
  'worker starting',
);

const connection = { url: env.REDIS_URL };

const cloneWorker = new Worker(
  'clone',
  async (job) => {
    const payload = CloneJobPayloadSchema.parse(job.data);
    await processCloneJob(payload);
  },
  { connection, concurrency: 2 },
);

const enumerateWorker = new Worker(
  'enumerate_sample',
  async (job) => {
    const payload = EnumerateSampleJobPayloadSchema.parse(job.data);
    await processEnumerateSampleJob(payload);
  },
  { connection, concurrency: 1 },
);

/**
 * Neo4j deltas: per-repo Redis lease (ADR 0011) allows multi-repo concurrency.
 * Same-repo jobs still serialize via withRepoNeo4jLock inside the processor.
 */
const parseCommitWorker = new Worker(
  'parse_commit',
  async (job) => {
    const payload = ParseCommitJobPayloadSchema.parse(job.data);
    await processParseCommitJob(payload);
  },
  { connection, concurrency: 4 },
);

const metricsWorker = new Worker(
  'metrics_write',
  async (job) => {
    const payload = MetricsWriteJobPayloadSchema.parse(job.data);
    await processMetricsWriteJob(payload);
  },
  { connection, concurrency: 1 },
);

const evolveWorker = new Worker(
  'evolve',
  async (job) => {
    const payload = EvolveJobPayloadSchema.parse(job.data);
    await processEvolveJob(payload);
  },
  { connection, concurrency: 1 },
);

const aiWorker = new Worker(
  'ai',
  async (job) => {
    const payload = AiGenerateJobPayloadSchema.parse(job.data);
    await processAiGenerateJob(payload);
  },
  { connection, concurrency: 1 },
);

for (const [name, worker] of [
  ['clone', cloneWorker],
  ['enumerate_sample', enumerateWorker],
  ['parse_commit', parseCommitWorker],
  ['metrics_write', metricsWorker],
  ['evolve', evolveWorker],
  ['ai', aiWorker],
] as const) {
  worker.on('ready', () => logger.info({ queue: name }, 'worker ready'));
  worker.on('completed', (job) =>
    logger.info({ queue: name, job_id: job.id }, 'job completed'),
  );
  worker.on('failed', (job, err) =>
    logger.error({ queue: name, job_id: job?.id, err: err.message }, 'job failed'),
  );
}

async function shutdown() {
  logger.info('shutting down worker');
  await Promise.all([
    cloneWorker.close(),
    enumerateWorker.close(),
    parseCommitWorker.close(),
    metricsWorker.close(),
    evolveWorker.close(),
    aiWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
