import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { CloneJobPayload } from '@gwi/shared-types';
import { env } from '../config/env';

export const CLONE_QUEUE = 'clone';

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly queue: Queue<CloneJobPayload>;

  constructor() {
    this.queue = new Queue<CloneJobPayload>(CLONE_QUEUE, {
      connection: { url: env.REDIS_URL },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    });
  }

  async enqueueClone(payload: CloneJobPayload) {
    await this.queue.add('clone', payload, { jobId: payload.jobId });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
