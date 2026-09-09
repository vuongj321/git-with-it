import type { GraphSnapshot, MetricsWriteJobPayload } from '@gwi/shared-types';
import { SampleConfigSchema, computeMetrics } from '@gwi/shared-types';
import { apiJson, patchRun } from './api';
import { logger } from './logger';
import { createS3, downloadBuffer, objectExists } from './s3';

async function loadSnapshot(
  s3: ReturnType<typeof createS3>,
  repoId: string,
  sha: string,
): Promise<GraphSnapshot | null> {
  const keys = [
    `repos/${repoId}/graphs/${sha}.json`,
    `graphs/${repoId}/snapshots/${sha}.json`,
  ];
  for (const key of keys) {
    if (!(await objectExists(s3, key))) continue;
    const buf = await downloadBuffer(s3, key);
    return JSON.parse(buf.toString('utf8')) as GraphSnapshot;
  }
  return null;
}

export async function processMetricsWriteJob(payload: MetricsWriteJobPayload) {
  const log = logger.child({
    job: 'metrics_write',
    runId: payload.runId,
    repoId: payload.repoId,
  });
  const config = SampleConfigSchema.parse(payload.sampleConfig ?? {});
  void config;
  const s3 = createS3();
  const sampleShas = payload.sampleShas;

  try {
    await patchRun(payload.runId, {
      status: 'metrics_writing',
      jobStatus: 'active',
      progress: 0,
    });

    for (let i = 0; i < sampleShas.length; i++) {
      const sha = sampleShas[i]!;
      const snapshot = await loadSnapshot(s3, payload.repoId, sha);
      if (!snapshot) {
        log.warn({ sha }, 'snapshot missing; skipping metrics');
        continue;
      }

      const rows = computeMetrics({
        repoId: payload.repoId,
        snapshot,
        topoIndex: i,
        authoredAt: null,
      });

      await apiJson(`/v1/internal/repos/${payload.repoId}/metrics/write`, {
        method: 'POST',
        body: { rows },
      });

      await patchRun(payload.runId, {
        status: 'metrics_writing',
        commitsDone: i + 1,
        progress: Math.round(((i + 1) / sampleShas.length) * 100),
      });
      log.info({ sha, rows: rows.length }, 'metrics written');
    }

    await apiJson(`/v1/internal/runs/${payload.runId}/enqueue-evolve`, {
      method: 'POST',
      body: {
        sampleShas,
        sampleConfig: payload.sampleConfig,
      },
    });

    await patchRun(payload.runId, {
      status: 'evolving',
      jobStatus: 'completed',
      progress: 100,
    });
    log.info('metrics_write done; evolve enqueued');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'metrics_write failed');
    await patchRun(payload.runId, {
      status: 'failed',
      jobStatus: 'failed',
      progress: 100,
      error: message,
    }).catch(() => undefined);
    throw err;
  }
}
