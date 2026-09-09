import type { GraphWriteJobPayload } from '@gwi/shared-types';
import { graphSnapshotKey } from '@gwi/shared-types';
import { apiJson, patchRun } from './api';
import { logger } from './logger';
import { createS3, ensureBucket, objectExists } from './s3';

export async function processGraphWriteJob(payload: GraphWriteJobPayload) {
  const log = logger.child({
    job_id: payload.jobId,
    run_id: payload.runId,
    repo_id: payload.repoId,
  });

  try {
    await patchRun(payload.runId, {
      status: 'graph_writing',
      jobStatus: 'active',
      progress: 20,
    });

    const s3 = createS3();
    await ensureBucket(s3);
    const artifactUri = graphSnapshotKey(
      payload.orgId,
      payload.repoId,
      payload.commitSha,
    );
    if (!(await objectExists(s3, artifactUri))) {
      throw new Error(`graph snapshot missing at ${artifactUri}`);
    }

    // API loads the snapshot from MinIO (avoids posting multi‑MB graphs over HTTP).
    await apiJson(`/v1/internal/repos/${payload.repoId}/graph/snapshot`, {
      method: 'POST',
      body: {
        sha: payload.commitSha,
        analyzerVersion: payload.analyzerVersion,
        artifactUri,
      },
    });

    await patchRun(payload.runId, {
      status: 'graph_ready',
      jobStatus: 'completed',
      progress: 100,
      error: null,
    });
    log.info({ artifactUri }, 'graph_ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'graph_write failed');
    await patchRun(payload.runId, {
      status: 'failed',
      jobStatus: 'failed',
      progress: 100,
      error: message,
    }).catch(() => undefined);
    throw err;
  }
}
