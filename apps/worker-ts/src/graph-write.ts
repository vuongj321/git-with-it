import type { GraphWriteJobPayload } from '@gwi/shared-types';
import { apiJson, patchRun } from './api';
import { logger } from './logger';
import { createS3, downloadBuffer, ensureBucket } from './s3';

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
    const key = `repos/${payload.repoId}/graphs/${payload.commitSha}.json`;
    const buf = await downloadBuffer(s3, key);
    const snapshot = JSON.parse(buf.toString('utf8')) as {
      nodes: Array<{
        id: string;
        kind: string;
        fqn: string;
        name: string;
        path?: string | null;
        language?: string | null;
        package?: string | null;
      }>;
      edges: Array<{ from: string; to: string; rel: string }>;
    };

    await apiJson(`/v1/internal/repos/${payload.repoId}/graph/snapshot`, {
      method: 'POST',
      body: {
        sha: payload.commitSha,
        analyzerVersion: payload.analyzerVersion,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
      },
    });

    await patchRun(payload.runId, {
      status: 'graph_ready',
      jobStatus: 'completed',
      progress: 100,
      error: null,
    });
    log.info(
      { nodes: snapshot.nodes.length, edges: snapshot.edges.length },
      'graph_ready',
    );
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
