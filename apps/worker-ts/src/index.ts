import { Worker } from 'bullmq';
import { CloneJobPayloadSchema } from '@gwi/shared-types';
import { processCloneJob } from './clone';
import { env } from './env';
import { logger } from './logger';

const QUEUE = 'clone';

const worker = new Worker(
  QUEUE,
  async (job) => {
    const payload = CloneJobPayloadSchema.parse(job.data);
    await processCloneJob(payload);
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 2,
  },
);

worker.on('ready', () => logger.info({ queue: QUEUE }, 'worker ready'));
worker.on('completed', (job) =>
  logger.info({ job_id: job.id }, 'job completed'),
);
worker.on('failed', (job, err) =>
  logger.error({ job_id: job?.id, err: err.message }, 'job failed'),
);

async function shutdown() {
  logger.info('shutting down worker');
  await worker.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
