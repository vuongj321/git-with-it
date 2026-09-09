/**
 * Temporal dual-run client (Phase 5).
 * When ORCHESTRATOR=temporal, starts AnalysisRunWorkflow; otherwise callers use BullMQ.
 */

import { Logger } from '@nestjs/common';
import { env } from '../config/env';

export type AnalysisWorkflowInput = {
  jobId: string;
  runId: string;
  repoId: string;
  orgId: string;
  remoteUrl: string;
  defaultBranch: string;
  encryptedPat?: string;
};

const log = new Logger('TemporalClient');

export function orchestratorMode(): 'bullmq' | 'temporal' {
  return env.ORCHESTRATOR === 'temporal' ? 'temporal' : 'bullmq';
}

/**
 * Start the analysis saga on Temporal.
 * Requires `@temporalio/client` installed and TEMPORAL_ADDRESS set for real starts;
 * without an address, logs a dual-run stub (staging soak).
 */
export async function startAnalysisWorkflow(
  input: AnalysisWorkflowInput,
): Promise<{ workflowId: string; runId: string }> {
  const workflowId = `analyze-${input.repoId}-${input.runId}`;
  if (!env.TEMPORAL_ADDRESS) {
    log.warn(
      `TEMPORAL_ADDRESS unset; would start workflow ${workflowId} (dual-run stub)`,
    );
    return { workflowId, runId: input.runId };
  }

  // Optional dependency — keep BullMQ-only installs working.
  let Client: new (opts: unknown) => {
    workflow: {
      start: (
        name: string,
        opts: unknown,
      ) => Promise<{ workflowId: string }>;
      getHandle: (id: string) => { cancel: () => Promise<void> };
    };
  };
  let Connection: { connect: (opts: { address: string }) => Promise<unknown> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@temporalio/client') as {
      Client: typeof Client;
      Connection: typeof Connection;
    };
    Client = mod.Client;
    Connection = mod.Connection;
  } catch {
    throw new Error(
      'ORCHESTRATOR=temporal requires @temporalio/client — pnpm add @temporalio/client in apps/api',
    );
  }

  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  const client = new Client({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
  });
  const handle = await client.workflow.start('analysisRunWorkflow', {
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowId,
    args: [input],
  });
  log.log(`started Temporal workflow ${handle.workflowId}`);
  return { workflowId: handle.workflowId, runId: input.runId };
}

export async function cancelAnalysisWorkflow(workflowId: string): Promise<void> {
  if (!env.TEMPORAL_ADDRESS) {
    log.warn(`cancel stub for ${workflowId}`);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@temporalio/client') as {
    Client: new (opts: unknown) => {
      workflow: { getHandle: (id: string) => { cancel: () => Promise<void> } };
    };
    Connection: { connect: (opts: { address: string }) => Promise<unknown> };
  };
  const connection = await mod.Connection.connect({ address: env.TEMPORAL_ADDRESS });
  const client = new mod.Client({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
  });
  await client.workflow.getHandle(workflowId).cancel();
}
