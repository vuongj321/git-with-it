/**
 * Temporal worker entry — registers analysisRunWorkflow + activities that
 * wrap the same processors as BullMQ. Start when ORCHESTRATOR=temporal:
 *
 *   pnpm --filter @gwi/worker-ts exec tsx src/temporal-worker.ts
 *
 * Requires optional peer `@temporalio/worker` and TEMPORAL_ADDRESS.
 */

import { env } from './env';
import { logger } from './logger';
import * as activities from './temporal/activities';
import { ANALYSIS_TASK_QUEUE } from './temporal/workflows';

async function main() {
  if (env.ORCHESTRATOR !== 'temporal') {
    logger.warn('ORCHESTRATOR is not temporal; exiting temporal-worker');
    return;
  }

  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) {
    throw new Error('TEMPORAL_ADDRESS required for temporal-worker');
  }

  let Worker: new (opts: unknown) => { run: () => Promise<void> };
  let NativeConnection: {
    connect: (opts: { address: string }) => Promise<unknown>;
  };
  try {
    // Optional dependency — keep BullMQ-only installs working.
    const mod = require('@temporalio/worker') as {
      Worker: typeof Worker;
      NativeConnection: typeof NativeConnection;
    };
    Worker = mod.Worker;
    NativeConnection = mod.NativeConnection;
  } catch {
    throw new Error(
      'ORCHESTRATOR=temporal requires @temporalio/worker — pnpm add @temporalio/worker in apps/worker-ts',
    );
  }

  const connection = await NativeConnection.connect({ address });
  const worker = new Worker({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? ANALYSIS_TASK_QUEUE,
    workflowsPath: require.resolve('./temporal/workflows'),
    activities,
  });

  logger.info({ address }, 'temporal worker starting');
  await worker.run();
}

main().catch((err) => {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    'temporal worker failed',
  );
  process.exit(1);
});
