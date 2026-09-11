/**
 * Temporal AnalysisRun workflow + activity factory (API-side definitions).
 * Worker-side durable implementation lives in apps/worker-ts/src/temporal/.
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

/**
 * Workflow control flow (documentation + dual-run stub).
 * The Temporal worker executes the isomorphic workflow under
 * `apps/worker-ts/src/temporal/workflows.ts` with proxyActivities.
 */
export async function analysisRunWorkflow(input: AnalysisRunInput): Promise<{
  runId: string;
  status: 'completed' | 'canceled';
}> {
  const stages = [
    'clone',
    'enumerateSample',
    'parseBatch',
    'metrics',
    'evolve',
    'aiInsights',
  ] as const;
  void stages;
  void input;
  // Client starts this workflow by name; worker runs the real activity chain.
  return { runId: input.runId, status: 'completed' };
}

export const ANALYSIS_TASK_QUEUE = 'gwi-analysis';
