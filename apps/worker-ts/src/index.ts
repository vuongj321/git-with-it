import { Worker } from 'bullmq';
import {
  CloneJobPayloadSchema,
  EnumerateSampleJobPayloadSchema,
  EvolveJobPayloadSchema,
  GraphWriteJobPayloadSchema,
  MetricsWriteJobPayloadSchema,
  ParseCommitJobPayloadSchema,
  ParseJobPayloadSchema,
} from '@gwi/shared-types';
import { processCloneJob } from './clone';
import { processEnumerateSampleJob } from './enumerate';
import { env } from './env';
import { processEvolveJob } from './evolve';
import { processGraphWriteJob } from './graph-write';
import { logger } from './logger';
import { processMetricsWriteJob } from './metrics-write';
import { processParseCommitJob } from './parse-commit';
import { processParseJob } from './parse';

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

const parseWorker = new Worker(
  'parse',
  async (job) => {
    const payload = ParseJobPayloadSchema.parse(job.data);
    await processParseJob(payload);
  },
  { connection, concurrency: 1 },
);

/** Single-writer-per-repo for Neo4j deltas: concurrency 1 on this queue. */
const parseCommitWorker = new Worker(
  'parse_commit',
  async (job) => {
    const payload = ParseCommitJobPayloadSchema.parse(job.data);
    await processParseCommitJob(payload);
  },
  { connection, concurrency: 1 },
);

const graphWorker = new Worker(
  'graph_write',
  async (job) => {
    const payload = GraphWriteJobPayloadSchema.parse(job.data);
    await processGraphWriteJob(payload);
  },
  { connection, concurrency: 1 },
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

for (const [name, worker] of [
  ['clone', cloneWorker],
  ['enumerate_sample', enumerateWorker],
  ['parse', parseWorker],
  ['parse_commit', parseCommitWorker],
  ['graph_write', graphWorker],
  ['metrics_write', metricsWorker],
  ['evolve', evolveWorker],
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
    parseWorker.close(),
    parseCommitWorker.close(),
    graphWorker.close(),
    metricsWorker.close(),
    evolveWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
