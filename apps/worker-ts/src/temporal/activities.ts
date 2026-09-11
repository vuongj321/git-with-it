/**
 * Temporal activities — wrap the same processors as BullMQ queues.
 */

import { ANALYZER_VERSION } from '@gwi/shared-types';
import { processAiGenerateJob } from '../ai';
import { apiJson } from '../api';
import { processCloneJob } from '../clone';
import { processEnumerateSampleJob } from '../enumerate';
import { processEvolveJob } from '../evolve';
import { processMetricsWriteJob } from '../metrics-write';
import { processParseCommitJob } from '../parse-commit';
import type { AnalysisRunInput } from './workflows';

export async function cloneStage(input: AnalysisRunInput) {
  await processCloneJob({
    jobId: input.jobId,
    runId: input.runId,
    repoId: input.repoId,
    orgId: input.orgId,
    remoteUrl: input.remoteUrl,
    defaultBranch: input.defaultBranch,
    encryptedPat: input.encryptedPat,
  } as never);
  const repo = await apiJson<{ cloneUri: string | null }>(
    `/v1/internal/repos/${input.repoId}`,
  );
  if (!repo.cloneUri) throw new Error(`repo ${input.repoId} missing cloneUri`);
  return { cloneUri: repo.cloneUri };
}

export async function enumerateStage(
  input: AnalysisRunInput & { cloneUri: string },
) {
  await processEnumerateSampleJob({
    jobId: input.jobId,
    runId: input.runId,
    repoId: input.repoId,
    orgId: input.orgId,
    cloneUri: input.cloneUri,
  } as never);
  const run = await apiJson<{ sampleShas?: string[] }>(
    `/v1/internal/runs/${input.runId}`,
  ).catch(() => ({ sampleShas: [] as string[] }));
  return { sampleShas: run.sampleShas ?? [] };
}

export async function parseStage(
  input: AnalysisRunInput & { cloneUri: string; sampleShas: string[] },
) {
  await processParseCommitJob({
    jobId: input.jobId,
    runId: input.runId,
    repoId: input.repoId,
    orgId: input.orgId,
    cloneUri: input.cloneUri,
    sampleShas: input.sampleShas,
    analyzerVersion: ANALYZER_VERSION,
  } as never);
  return { tipSha: input.sampleShas[input.sampleShas.length - 1] ?? '' };
}

export async function metricsStage(
  input: AnalysisRunInput & { sampleShas: string[] },
) {
  await processMetricsWriteJob({
    jobId: input.jobId,
    runId: input.runId,
    repoId: input.repoId,
    orgId: input.orgId,
    sampleShas: input.sampleShas,
  } as never);
}

export async function evolveStage(input: AnalysisRunInput) {
  await processEvolveJob({
    jobId: input.jobId,
    runId: input.runId,
    repoId: input.repoId,
    orgId: input.orgId,
  } as never);
}

export async function aiStage(input: AnalysisRunInput) {
  await processAiGenerateJob({
    jobId: input.jobId,
    runId: input.runId,
    repoId: input.repoId,
    orgId: input.orgId,
  } as never);
}
