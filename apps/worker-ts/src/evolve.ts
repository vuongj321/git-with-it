import { rm } from 'node:fs/promises';
import type { EvolveJobPayload } from '@gwi/shared-types';
import {
  SampleConfigSchema,
  diffGraphs,
  eventsFromDiff,
  type GraphSnapshot,
} from '@gwi/shared-types';
import { apiJson, patchRun } from './api';
import { logger } from './logger';
import { createS3, downloadBuffer, ensureBucket } from './s3';

async function loadSnapshot(
  s3: ReturnType<typeof createS3>,
  repoId: string,
  sha: string,
): Promise<GraphSnapshot> {
  const keys = [
    `graphs/${repoId}/snapshots/${sha}.json`,
    `repos/${repoId}/graphs/${sha}.json`,
  ];
  let lastErr: unknown;
  for (const key of keys) {
    try {
      const buf = await downloadBuffer(s3, key);
      return JSON.parse(buf.toString('utf8')) as GraphSnapshot;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`snapshot not found for ${sha}`);
}

export async function processEvolveJob(payload: EvolveJobPayload) {
  const log = logger.child({
    job_id: payload.jobId,
    run_id: payload.runId,
    repo_id: payload.repoId,
  });
  const config = SampleConfigSchema.parse(payload.sampleConfig ?? {});

  try {
    await patchRun(payload.runId, {
      status: 'evolving',
      jobStatus: 'active',
      progress: 10,
    });

    const s3 = createS3();
    await ensureBucket(s3);
    const shas = payload.sampleShas;

    for (let i = 1; i < shas.length; i++) {
      const fromSha = shas[i - 1]!;
      const toSha = shas[i]!;
      const from = await loadSnapshot(s3, payload.repoId, fromSha);
      const to = await loadSnapshot(s3, payload.repoId, toSha);
      const diff = diffGraphs(from, to, {
        couplingDeltaThreshold: config.couplingDeltaThreshold,
      });
      const events = eventsFromDiff(diff, {
        couplingDeltaThreshold: config.couplingDeltaThreshold,
      });

      if (events.length) {
        await apiJson(`/v1/internal/repos/${payload.repoId}/evolution-events`, {
          method: 'POST',
          body: {
            runId: payload.runId,
            fromSha,
            toSha,
            events,
          },
        });
      }

      await patchRun(payload.runId, {
        status: 'evolving',
        progress: Math.round((i / (shas.length - 1 || 1)) * 90),
      });
    }

    await apiJson(`/v1/internal/runs/${payload.runId}/enqueue-ai`, {
      method: 'POST',
      body: {
        sampleShas: payload.sampleShas,
        sampleConfig: payload.sampleConfig,
      },
    });

    await patchRun(payload.runId, {
      status: 'ai_generating',
      jobStatus: 'completed',
      progress: 100,
      error: null,
    });
    log.info({ pairs: Math.max(0, shas.length - 1) }, 'evolve done; ai enqueued');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'evolve failed');
    await patchRun(payload.runId, {
      status: 'failed',
      jobStatus: 'failed',
      progress: 100,
      error: message,
    }).catch(() => undefined);
    throw err;
  } finally {
    await rm('.tmp', { force: true }).catch(() => undefined);
  }
}
