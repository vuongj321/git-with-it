import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type {
  CloneJobPayload,
  GraphWriteJobPayload,
  ParseJobPayload,
} from '@gwi/shared-types';
import { env } from '../config/env';

export const CLONE_QUEUE = 'clone';
export const PARSE_QUEUE = 'parse';
export const GRAPH_WRITE_QUEUE = 'graph_write';

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly cloneQueue: Queue<CloneJobPayload>;
  private readonly parseQueue: Queue<ParseJobPayload>;
  private readonly graphQueue: Queue<GraphWriteJobPayload>;

  constructor() {
    const connection = { url: env.REDIS_URL };
    const defaults = {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 2,
      backoff: { type: 'exponential' as const, delay: 5_000 },
    };
    this.cloneQueue = new Queue<CloneJobPayload>(CLONE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
    this.parseQueue = new Queue<ParseJobPayload>(PARSE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
    this.graphQueue = new Queue<GraphWriteJobPayload>(GRAPH_WRITE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
  }

  async enqueueClone(payload: CloneJobPayload) {
    await this.cloneQueue.add('clone', payload, { jobId: payload.jobId });
  }

  async enqueueParse(payload: ParseJobPayload) {
    await this.parseQueue.add('parse', payload, { jobId: payload.jobId });
  }

  async enqueueGraphWrite(payload: GraphWriteJobPayload) {
    await this.graphQueue.add('graph_write', payload, { jobId: payload.jobId });
  }

  async onModuleDestroy() {
    await Promise.all([
      this.cloneQueue.close(),
      this.parseQueue.close(),
      this.graphQueue.close(),
    ]);
  }
}
