/**
 * Temporal AnalysisRun workflow + activities (Phase 5).
 * Workers register these when ORCHESTRATOR=temporal.
 *
 * Activity implementations call the same internal APIs / worker functions as BullMQ
 * stages so idempotency keys (repo_id, analyzer_version, sha, stage) stay shared.
 */

export type AnalysisRunInput = {
  jobId: string;
  runId: string;
  repoId: string;
  orgId: string;
  remoteUrl: string;
  defaultBranch: string;
  encryptedPat?: string;
};

/** Workflow definition (executed inside Temporal worker runtime). */
export async function analysisRunWorkflow(input: AnalysisRunInput): Promise<{
  runId: string;
  status: 'completed' | 'canceled';
}> {
  // Placeholder structure for the Temporal worker package.
  // Real worker binds proxyActivities with heartbeats on parse batches.
  const stages = [
    'clone',
    'enumerateSample',
    'parseBatch',
    'graphDelta',
    'metrics',
    'checkpoint',
    'evolve',
    'aiInsights',
  ] as const;
  void stages;
  void input;
  return { runId: input.runId, status: 'completed' };
}

export const ANALYSIS_TASK_QUEUE = 'gwi-analysis';
