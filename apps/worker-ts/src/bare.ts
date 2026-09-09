import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import * as tar from 'tar';
import { env } from './env';
import { runCommand } from './git';
import {
  createS3,
  downloadToFile,
  ensureBucket,
  keyFromCloneUri,
} from './s3';

export async function unpackBareArchive(archivePath: string, destDir: string) {
  if (archivePath.endsWith('.tar.zst')) {
    const tarPath = archivePath.replace(/\.zst$/, '');
    await runCommand('zstd', ['-d', '-f', '-q', '-o', tarPath, archivePath], {
      timeoutMs: 120_000,
    });
    await tar.x({ file: tarPath, cwd: destDir });
    await rm(tarPath, { force: true });
  } else {
    await pipeline(
      createReadStream(archivePath),
      createGunzip(),
      tar.x({ cwd: destDir }),
    );
  }
}

export async function materializeWorktree(
  bareDir: string,
  worktree: string,
  sha: string,
) {
  await mkdir(worktree, { recursive: true });
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const git = spawn('git', ['--git-dir', bareDir, 'archive', sha], {
      windowsHide: true,
    });
    const extract = tar.x({ cwd: worktree });
    git.stdout.pipe(extract);
    let stderr = '';
    git.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    git.on('error', reject);
    extract.on('error', reject);
    extract.on('finish', () => resolve());
    git.on('close', (code) => {
      if (code !== 0) reject(new Error(`git archive failed: ${stderr}`));
    });
  });
}

/** Download clone artifact and return bare git dir path + work root (caller cleans up). */
export async function openBareFromCloneUri(cloneUri: string): Promise<{
  workRoot: string;
  bareDir: string;
}> {
  await mkdir(env.WORKER_TMP_DIR, { recursive: true });
  const workRoot = await mkdtemp(path.join(env.WORKER_TMP_DIR, 'bare-'));
  const s3 = createS3();
  await ensureBucket(s3);
  const key = keyFromCloneUri(cloneUri);
  const archivePath = path.join(
    workRoot,
    key.endsWith('.zst') ? 'bare.tar.zst' : 'bare.tar.gz',
  );
  await downloadToFile(s3, key, archivePath);
  const unpackDir = path.join(workRoot, 'unpack');
  await mkdir(unpackDir, { recursive: true });
  await unpackBareArchive(archivePath, unpackDir);
  const top = await readdir(unpackDir);
  const bareDir = path.join(unpackDir, top[0] ?? 'repo.git');
  return { workRoot, bareDir };
}

export async function runBin(
  bin: string,
  args: string[],
  opts: { input?: string } = {},
) {
  const { spawn } = await import('node:child_process');
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr || stdout}`));
    });
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}
