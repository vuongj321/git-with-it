import { rm } from 'node:fs/promises';
import type { EnumerateSampleJobPayload } from '@gwi/shared-types';
import {
  SampleConfigSchema,
  applySampleDensityBackoff,
  estimateParseMinutes,
  sampleFirstParentCommits,
  type WalkedCommit,
} from '@gwi/shared-types';
import { apiJson, chunkArray, patchRun } from './api';
import { openBareFromCloneUri } from './bare';
import { gwiGit } from './git';
import { logger } from './logger';

type LogLine = {
  sha: string;
  parents: string[];
  authored_at: string;
  message: string;
};

export async function processEnumerateSampleJob(
  payload: EnumerateSampleJobPayload,
) {
  const log = logger.child({
    job_id: payload.jobId,
    run_id: payload.runId,
    repo_id: payload.repoId,
  });

  const config = SampleConfigSchema.parse(payload.sampleConfig ?? {});
  let workRoot: string | undefined;

  try {
    await patchRun(payload.runId, {
      status: 'enumerating',
      jobStatus: 'active',
      progress: 5,
      commitSha: payload.tipSha,
      analyzerVersion: payload.analyzerVersion,
    });

    const opened = await openBareFromCloneUri(payload.cloneUri);
    workRoot = opened.workRoot;
    const { bareDir } = opened;

    const walkMax = Math.max(config.lastN * 4, 500);
    const logRes = await gwiGit([
      'log-first-parent',
      '--path',
      bareDir,
      '--rev',
      payload.tipSha,
      '--max',
      String(walkMax),
    ]);

    const walked: WalkedCommit[] = [];
    for (const line of logRes.stdout.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as LogLine;
      walked.push({
        sha: row.sha,
        parentShas: row.parents ?? [],
        authoredAt: row.authored_at ? new Date(row.authored_at) : null,
        message: row.message ?? '',
        depthFromTip: walked.length,
      });
    }

    if (walked.length === 0) {
      throw new Error('No commits found on first-parent walk');
    }

    const estimated = estimateParseMinutes(
      Math.min(config.lastN, walked.length),
      config.secondsPerCommit,
    );
    const backoff = applySampleDensityBackoff({
      estimatedMinutes: estimated,
      slaMinutes: config.slaMinutes,
      policy: { lastN: config.lastN, monthlyAnchors: config.monthlyAnchors },
    });
    if (backoff.steps > 0) {
      log.warn(
        {
          estimatedMinutes: estimated,
          slaMinutes: config.slaMinutes,
          fromLastN: config.lastN,
          toLastN: backoff.policy.lastN,
          reason: backoff.reason,
        },
        'sample density backoff applied',
      );
    }

    const samples = sampleFirstParentCommits(walked, backoff.policy);

    log.info(
      { walked: walked.length, sampled: samples.length },
      'sampled first-parent history',
    );

    const commitPayload = walked.map((c) => ({
      sha: c.sha,
      parentShas: c.parentShas,
      authoredAt: c.authoredAt?.toISOString() ?? null,
      message: c.message,
    }));
    const samplePayload = samples.map((s) => ({
      sha: s.sha,
      topoIndex: s.topoIndex,
      reason: s.reason,
    }));

    // Large histories can exceed Nest’s JSON body limit — chunk commits.
    const commitBatches = chunkArray(commitPayload, 400);
    for (let i = 0; i < commitBatches.length; i++) {
      await apiJson(`/v1/internal/repos/${payload.repoId}/commits/upsert`, {
        method: 'POST',
        body: {
          runId: payload.runId,
          commits: commitBatches[i],
          samples: i === 0 ? samplePayload : [],
          sampleConfig: i === 0 ? config : undefined,
        },
      });
    }

    const sampleShas = samples.map((s) => s.sha);

    await patchRun(payload.runId, {
      status: 'enumerating',
      jobStatus: 'completed',
      progress: 100,
      sampleShas,
      commitsDone: 0,
      commitsTotal: sampleShas.length,
      sampleConfig: config,
    });

    await apiJson(`/v1/internal/runs/${payload.runId}/enqueue-parse-commits`, {
      method: 'POST',
      body: {
        cloneUri: payload.cloneUri,
        analyzerVersion: payload.analyzerVersion,
        sampleShas,
        sampleConfig: config,
      },
    });

    log.info({ sampleCount: sampleShas.length }, 'enumerate done; parse_commit enqueued');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'enumerate_sample failed');
    await patchRun(payload.runId, {
      status: 'failed',
      jobStatus: 'failed',
      progress: 100,
      error: message,
    }).catch(() => undefined);
    throw err;
  } finally {
    if (workRoot) {
      await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
