import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type {
  CloneJobPayload,
  EnumerateSampleJobPayload,
  EvolveJobPayload,
  GraphWriteJobPayload,
  MetricsWriteJobPayload,
  ParseCommitJobPayload,
  ParseJobPayload,
} from '@gwi/shared-types';
import { env } from '../config/env';

export const CLONE_QUEUE = 'clone';
export const ENUMERATE_QUEUE = 'enumerate_sample';
export const PARSE_QUEUE = 'parse';
export const PARSE_COMMIT_QUEUE = 'parse_commit';
export const GRAPH_WRITE_QUEUE = 'graph_write';
export const METRICS_WRITE_QUEUE = 'metrics_write';
export const EVOLVE_QUEUE = 'evolve';

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly cloneQueue: Queue<CloneJobPayload>;
  private readonly enumerateQueue: Queue<EnumerateSampleJobPayload>;
  private readonly parseQueue: Queue<ParseJobPayload>;
  private readonly parseCommitQueue: Queue<ParseCommitJobPayload>;
  private readonly graphQueue: Queue<GraphWriteJobPayload>;
  private readonly metricsQueue: Queue<MetricsWriteJobPayload>;
  private readonly evolveQueue: Queue<EvolveJobPayload>;

  constructor() {
    const connection = { url: env.REDIS_URL };
    const defaults = {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 2,
      backoff: { type: 'exponential' as const, delay: 5_000 },
    };
    this.cloneQueue = new Queue(CLONE_QUEUE, { connection, defaultJobOptions: defaults });
    this.enumerateQueue = new Queue(ENUMERATE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
    this.parseQueue = new Queue(PARSE_QUEUE, { connection, defaultJobOptions: defaults });
    this.parseCommitQueue = new Queue(PARSE_COMMIT_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
    this.graphQueue = new Queue(GRAPH_WRITE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
    this.metricsQueue = new Queue(METRICS_WRITE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
    this.evolveQueue = new Queue(EVOLVE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    });
  }

  async enqueueClone(payload: CloneJobPayload) {
    await this.cloneQueue.add('clone', payload, { jobId: payload.jobId });
  }

  async enqueueEnumerate(payload: EnumerateSampleJobPayload) {
    await this.enumerateQueue.add('enumerate_sample', payload, {
      jobId: payload.jobId,
    });
  }

  async enqueueParse(payload: ParseJobPayload) {
    await this.parseQueue.add('parse', payload, { jobId: payload.jobId });
  }

  async enqueueParseCommit(payload: ParseCommitJobPayload) {
    await this.parseCommitQueue.add('parse_commit', payload, {
      jobId: payload.jobId,
    });
  }

  async enqueueGraphWrite(payload: GraphWriteJobPayload) {
    await this.graphQueue.add('graph_write', payload, { jobId: payload.jobId });
  }

  async enqueueMetricsWrite(payload: MetricsWriteJobPayload) {
    await this.metricsQueue.add('metrics_write', payload, { jobId: payload.jobId });
  }

  async enqueueEvolve(payload: EvolveJobPayload) {
    await this.evolveQueue.add('evolve', payload, { jobId: payload.jobId });
  }

  async onModuleDestroy() {
    await Promise.all([
      this.cloneQueue.close(),
      this.enumerateQueue.close(),
      this.parseQueue.close(),
      this.parseCommitQueue.close(),
      this.graphQueue.close(),
      this.metricsQueue.close(),
      this.evolveQueue.close(),
    ]);
  }
}
