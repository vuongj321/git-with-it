import { Worker } from 'bullmq';
import {
  CloneJobPayloadSchema,
  GraphWriteJobPayloadSchema,
  ParseJobPayloadSchema,
} from '@gwi/shared-types';
import { processCloneJob } from './clone';
import { env } from './env';
import { processGraphWriteJob } from './graph-write';
import { logger } from './logger';
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

const parseWorker = new Worker(
  'parse',
  async (job) => {
    const payload = ParseJobPayloadSchema.parse(job.data);
    await processParseJob(payload);
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

for (const [name, worker] of [
  ['clone', cloneWorker],
  ['parse', parseWorker],
  ['graph_write', graphWorker],
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
  await Promise.all([cloneWorker.close(), parseWorker.close(), graphWorker.close()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
