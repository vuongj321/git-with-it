import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import { createReadStream } from 'node:fs';
import type { ParseJobPayload } from '@gwi/shared-types';
import * as tar from 'tar';
import { apiJson, patchRun } from './api';
import { env } from './env';
import { runCommand } from './git';
import { logger } from './logger';
import {
  createS3,
  downloadBuffer,
  downloadToFile,
  ensureBucket,
  keyFromCloneUri,
  objectExists,
  uploadBuffer,
} from './s3';

type ParseSymbol = {
  kind: string;
  name: string;
  fqn: string;
  span: { start_line: number; end_line: number };
  export: boolean;
};

type FileParseResult = {
  analyzer_version: string;
  file: {
    path: string;
    language: string;
    loc: number;
    package?: string;
  };
  symbols: ParseSymbol[];
  refs: unknown[];
};

async function unpackBareArchive(archivePath: string, destDir: string) {
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

async function materializeWorktree(bareDir: string, worktree: string, sha: string) {
  await mkdir(worktree, { recursive: true });
  // git archive from bare → tar stream → extract
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const git = spawn(
      'git',
      ['--git-dir', bareDir, 'archive', sha],
      { windowsHide: true },
    );
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

function cacheKey(oid: string, zstd: boolean) {
  return zstd ? `blobs/${oid}.parse.json.zst` : `blobs/${oid}.parse.json.gz`;
}

async function loadParseCache(
  s3: ReturnType<typeof createS3>,
  oid: string,
): Promise<FileParseResult | null> {
  for (const zstd of [true, false]) {
    const key = cacheKey(oid, zstd);
    if (!(await objectExists(s3, key))) continue;
    const buf = await downloadBuffer(s3, key);
    try {
      const json = zstd
        ? await decompressZstd(buf)
        : gunzipSync(buf).toString('utf8');
      return JSON.parse(json) as FileParseResult;
    } catch {
      continue;
    }
  }
  return null;
}

async function storeParseCache(
  s3: ReturnType<typeof createS3>,
  oid: string,
  result: FileParseResult,
) {
  const json = Buffer.from(JSON.stringify(result), 'utf8');
  try {
    await runCommand('zstd', ['--version'], { timeoutMs: 3_000 });
    const tmp = path.join(env.WORKER_TMP_DIR, `cache-${oid}.json`);
    const out = `${tmp}.zst`;
    await writeFile(tmp, json);
    await runCommand('zstd', ['-f', '-q', '-o', out, tmp], { timeoutMs: 30_000 });
    const body = await readFile(out);
    await uploadBuffer(s3, cacheKey(oid, true), body, 'application/zstd');
    await rm(tmp, { force: true });
    await rm(out, { force: true });
  } catch {
    const body = gzipSync(json);
    await uploadBuffer(s3, cacheKey(oid, false), body, 'application/gzip');
  }
}

async function decompressZstd(buf: Buffer): Promise<string> {
  const tmpIn = path.join(env.WORKER_TMP_DIR, `zstd-in-${Date.now()}`);
  const tmpOut = `${tmpIn}.out`;
  await mkdir(env.WORKER_TMP_DIR, { recursive: true });
  await writeFile(tmpIn, buf);
  await runCommand('zstd', ['-d', '-f', '-q', '-o', tmpOut, tmpIn], {
    timeoutMs: 30_000,
  });
  const text = await readFile(tmpOut, 'utf8');
  await rm(tmpIn, { force: true });
  await rm(tmpOut, { force: true });
  return text;
}

async function runBin(bin: string, args: string[], opts: { input?: string } = {}) {
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

export async function processParseJob(payload: ParseJobPayload) {
  const log = logger.child({
    job_id: payload.jobId,
    run_id: payload.runId,
    repo_id: payload.repoId,
  });

  await mkdir(env.WORKER_TMP_DIR, { recursive: true });
  const workRoot = await mkdtemp(path.join(env.WORKER_TMP_DIR, 'parse-'));

  try {
    await patchRun(payload.runId, {
      status: 'parsing',
      jobStatus: 'active',
      progress: 10,
      commitSha: payload.commitSha,
      analyzerVersion: payload.analyzerVersion,
    });

    const s3 = createS3();
    await ensureBucket(s3);
    const key = keyFromCloneUri(payload.cloneUri);
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

    const worktree = path.join(workRoot, 'tree');
    await materializeWorktree(bareDir, worktree, payload.commitSha);

    const parseOut = await runBin(env.GWI_PARSE_BIN, ['dir', '--root', worktree]);

    const lines = parseOut.stdout.split('\n').filter((l) => l.trim());
    const results: FileParseResult[] = [];
    let cacheHits = 0;

    for (const line of lines) {
      const parsed = JSON.parse(line) as FileParseResult;
      if (!parsed.file?.path) continue;

      let oid = '';
      try {
        const oidRes = await runCommand(
          env.GWI_GIT_BIN,
          [
            'blob-oid',
            '--path',
            bareDir,
            '--sha',
            payload.commitSha,
            '--file',
            parsed.file.path,
          ],
          { timeoutMs: 30_000 },
        );
        oid = oidRes.stdout.trim();
      } catch {
        oid = createHash('sha1').update(parsed.file.path).digest('hex');
      }

      const cached = oid ? await loadParseCache(s3, oid) : null;
      if (cached && cached.analyzer_version === payload.analyzerVersion) {
        cacheHits += 1;
        results.push(cached);
        continue;
      }
      results.push(parsed);
      if (oid) await storeParseCache(s3, oid, parsed);
    }

    log.info({ files: results.length, cacheHits }, 'parse complete');

    // Upsert entities
    const entityPayload = results.flatMap((r) =>
      r.symbols.map((s) => ({
        kind: s.kind as
          | 'package'
          | 'file'
          | 'class'
          | 'interface'
          | 'function'
          | 'method'
          | 'variable',
        fqn: s.fqn,
        name: s.name,
        language: r.file.language,
        path: r.file.path,
        loc: r.file.loc,
        startLine: s.span?.start_line ?? null,
        endLine: s.span?.end_line ?? null,
        export: s.export,
      })),
    );

    // Batch upserts
    const batchSize = 200;
    for (let i = 0; i < entityPayload.length; i += batchSize) {
      const batch = entityPayload.slice(i, i + batchSize);
      await apiJson(`/v1/internal/repos/${payload.repoId}/entities/upsert`, {
        method: 'POST',
        body: {
          commitSha: payload.commitSha,
          analyzerVersion: payload.analyzerVersion,
          entities: batch,
        },
      });
    }

    // Link + graph snapshot artifact for graph_write job
    const parseJsonl = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const linked = await runBin(env.GWI_LINK_BIN, ['jsonl', '--root', worktree], {
      input: parseJsonl,
    });
    const graph = await runBin(
      env.GWI_GRAPH_BIN,
      [
        'build',
        '--repo-id',
        payload.repoId,
        '--sha',
        payload.commitSha,
        '--analyzer-version',
        payload.analyzerVersion,
      ],
      { input: linked.stdout },
    );

    const artifactKey = `repos/${payload.repoId}/graphs/${payload.commitSha}.json`;
    await uploadBuffer(
      s3,
      artifactKey,
      Buffer.from(graph.stdout, 'utf8'),
      'application/json',
    );

    await patchRun(payload.runId, {
      status: 'parsing',
      jobStatus: 'completed',
      progress: 100,
    });

    await apiJson(`/v1/internal/runs/${payload.runId}/enqueue-graph-write`, {
      method: 'POST',
      body: {
        commitSha: payload.commitSha,
        analyzerVersion: payload.analyzerVersion,
      },
    });

    log.info({ artifactKey }, 'parse job done; graph_write enqueued');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'parse failed');
    await patchRun(payload.runId, {
      status: 'failed',
      jobStatus: 'failed',
      progress: 100,
      error: message,
    }).catch(() => undefined);
    throw err;
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

