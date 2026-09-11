/**
 * Temporal AnalysisRun workflow (worker-side).
 * Must stay in sync with apps/api/src/temporal/workflows.ts workflow name/args.
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

export async function analysisRunWorkflow(input: AnalysisRunInput): Promise<{
  runId: string;
  status: 'completed' | 'canceled';
  tipSha?: string;
}> {
  // Imported by Temporal worker sandbox; activities are proxied at runtime.
  const { proxyActivities } = require('@temporalio/workflow') as {
    proxyActivities: <T>(opts: { startToCloseTimeout: string; heartbeatTimeout?: string }) => T;
  };

  const activities = proxyActivities<{
    cloneStage: (input: AnalysisRunInput) => Promise<{ cloneUri: string }>;
    enumerateStage: (
      input: AnalysisRunInput & { cloneUri: string },
    ) => Promise<{ sampleShas: string[] }>;
    parseStage: (
      input: AnalysisRunInput & { cloneUri: string; sampleShas: string[] },
    ) => Promise<{ tipSha: string }>;
    metricsStage: (
      input: AnalysisRunInput & { sampleShas: string[] },
    ) => Promise<void>;
    evolveStage: (input: AnalysisRunInput) => Promise<void>;
    aiStage: (input: AnalysisRunInput) => Promise<void>;
  }>({
    startToCloseTimeout: '2 hours',
    heartbeatTimeout: '5 minutes',
  });

  const cloned = await activities.cloneStage(input);
  const enumerated = await activities.enumerateStage({
    ...input,
    cloneUri: cloned.cloneUri,
  });
  const parsed = await activities.parseStage({
    ...input,
    cloneUri: cloned.cloneUri,
    sampleShas: enumerated.sampleShas,
  });
  await activities.metricsStage({
    ...input,
    sampleShas: enumerated.sampleShas,
  });
  await activities.evolveStage(input);
  await activities.aiStage(input);
  return { runId: input.runId, status: 'completed', tipSha: parsed.tipSha };
}

export const ANALYSIS_TASK_QUEUE = 'gwi-analysis';
