import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { CloneJobPayload } from '@gwi/shared-types';
import * as tar from 'tar';
import { decryptPat, serviceToken } from './crypto';
import { env } from './env';
import { gwiGit, runCommand } from './git';
import { logger } from './logger';
import { createS3, ensureBucket, uploadFile } from './s3';

async function patchRun(runId: string, body: Record<string, unknown>) {
  const res = await fetch(`${env.API_URL}/v1/internal/runs/${runId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${serviceToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to patch run ${runId}: ${res.status} ${text}`);
  }
}

async function dirSizeBytes(root: string): Promise<number> {
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += await dirSizeBytes(full);
    else total += (await stat(full)).size;
  }
  return total;
}

type PackedArchive = { archivePath: string; keyExt: 'tar.zst' | 'tar.gz' };

/** Prefer zstd when available; fall back to gzip for Windows/dev without zstd. */
async function packBareRepo(bareDir: string, workRoot: string): Promise<PackedArchive> {
  const parent = path.dirname(bareDir);
  const base = path.basename(bareDir);

  try {
    await runCommand('zstd', ['--version'], { timeoutMs: 5_000 });
    const tarPath = path.join(workRoot, 'bare.tar');
    const outFile = path.join(workRoot, 'bare.tar.zst');
    await tar.create({ cwd: parent, file: tarPath }, [base]);
    await runCommand('zstd', ['-f', '-q', '-o', outFile, tarPath], { timeoutMs: 120_000 });
    await rm(tarPath, { force: true });
    return { archivePath: outFile, keyExt: 'tar.zst' };
  } catch {
    const outFile = path.join(workRoot, 'bare.tar.gz');
    await pipeline(
      tar.create({ cwd: parent, gzip: false }, [base]),
      createGzip({ level: 6 }),
      createWriteStream(outFile),
    );
    return { archivePath: outFile, keyExt: 'tar.gz' };
  }
}

export async function processCloneJob(payload: CloneJobPayload) {
  const log = logger.child({
    job_id: payload.jobId,
    run_id: payload.runId,
    repo_id: payload.repoId,
    org_id: payload.orgId,
  });

  await mkdir(env.WORKER_TMP_DIR, { recursive: true });
  const workRoot = await mkdtemp(path.join(env.WORKER_TMP_DIR, 'clone-'));
  const bareDir = path.join(workRoot, 'repo.git');

  try {
    await patchRun(payload.runId, {
      status: 'cloning',
      repoStatus: 'cloning',
      jobStatus: 'active',
      progress: 10,
    });
    log.info('clone started');

    const token = payload.encryptedPat ? decryptPat(payload.encryptedPat) : undefined;
    const cloneArgs = [
      'clone',
      '--url',
      payload.remoteUrl,
      '--path',
      bareDir,
      '--branch',
      payload.defaultBranch,
    ];
    if (token) cloneArgs.push('--token', token);

    await gwiGit(cloneArgs);

    const size = await dirSizeBytes(bareDir);
    if (size > env.MAX_CLONE_BYTES) {
      throw new Error(`Clone exceeds max size (${size} > ${env.MAX_CLONE_BYTES} bytes)`);
    }

    const head = await runCommand('git', ['-C', bareDir, 'rev-parse', 'HEAD']);
    const sha = head.stdout.trim();

    await patchRun(payload.runId, {
      status: 'uploading',
      progress: 60,
      jobStatus: 'active',
    });
    log.info({ sha, size }, 'uploading bare archive');

    const packed = await packBareRepo(bareDir, workRoot);
    const objectKey = `repos/${payload.repoId}/bare.${packed.keyExt}`;

    const s3 = createS3();
    await ensureBucket(s3);
    const cloneUri = await uploadFile(
      s3,
      objectKey,
      packed.archivePath,
      packed.keyExt === 'tar.zst' ? 'application/zstd' : 'application/gzip',
    );

    await patchRun(payload.runId, {
      status: 'ready',
      repoStatus: 'ready',
      jobStatus: 'completed',
      progress: 100,
      cloneUri,
      lastSyncedSha: sha,
      error: null,
    });
    log.info({ cloneUri, sha }, 'clone ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'clone failed');
    await patchRun(payload.runId, {
      status: 'failed',
      repoStatus: 'failed',
      jobStatus: 'failed',
      progress: 100,
      error: message,
    }).catch((patchErr) => {
      log.error({ patchErr }, 'failed to persist failure status');
    });
    throw err;
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
