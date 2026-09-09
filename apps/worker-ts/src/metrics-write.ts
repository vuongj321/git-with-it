import type { MetricsWriteJobPayload } from '@gwi/shared-types';
import { SampleConfigSchema } from '@gwi/shared-types';
import { apiJson, patchRun } from './api';
import { logger } from './logger';
import { createS3, objectExists } from './s3';

async function resolveSnapshotUri(
  s3: ReturnType<typeof createS3>,
  repoId: string,
  sha: string,
): Promise<string | null> {
  const keys = [
    `repos/${repoId}/graphs/${sha}.json`,
    `graphs/${repoId}/snapshots/${sha}.json`,
  ];
  for (const key of keys) {
    if (await objectExists(s3, key)) return key;
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
      const artifactUri = await resolveSnapshotUri(s3, payload.repoId, sha);
      if (!artifactUri) {
        log.warn({ sha }, 'snapshot missing; skipping metrics');
        continue;
      }

      // API loads the graph from MinIO and computes metrics (avoids 413 on large row payloads).
      const result = await apiJson<{ ok: boolean; inserted: number }>(
        `/v1/internal/repos/${payload.repoId}/metrics/write`,
        {
          method: 'POST',
          body: {
            sha,
            topoIndex: i,
            authoredAt: null,
            artifactUri,
          },
        },
      );

      await patchRun(payload.runId, {
        status: 'metrics_writing',
        commitsDone: i + 1,
        progress: Math.round(((i + 1) / sampleShas.length) * 100),
      });
      log.info({ sha, inserted: result.inserted }, 'metrics written');
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
