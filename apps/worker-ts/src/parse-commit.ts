import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ParseCommitJobPayload } from '@gwi/shared-types';
import {
  SampleConfigSchema,
  blobParseKey,
  diffGraphs,
  graphCheckpointKey,
  graphDeltaKey,
  graphSnapshotKey,
  type GraphEdge,
  type GraphSnapshot,
} from '@gwi/shared-types';
import { apiJson, patchRun } from './api';
import { materializeWorktree, openBareFromCloneUri, runBin } from './bare';
import { env } from './env';
import { gwiGit, runCommand } from './git';
import { logger } from './logger';
import {
  createS3,
  downloadBuffer,
  ensureBucket,
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

type DiffEntry = {
  status: string;
  path: string;
  old_path: string | null;
  old_oid: string;
  new_oid: string;
  score: number | null;
};

function cacheKey(orgId: string, oid: string, zstd: boolean) {
  return blobParseKey(orgId, oid, zstd);
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

async function loadParseCache(
  s3: ReturnType<typeof createS3>,
  orgId: string,
  oid: string,
): Promise<FileParseResult | null> {
  for (const zstd of [true, false]) {
    const key = cacheKey(orgId, oid, zstd);
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
  orgId: string,
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
    await uploadBuffer(s3, cacheKey(orgId, oid, true), body, 'application/zstd');
    await rm(tmp, { force: true });
    await rm(out, { force: true });
  } catch {
    const body = gzipSync(json);
    await uploadBuffer(s3, cacheKey(orgId, oid, false), body, 'application/gzip');
  }
}

async function compressJson(obj: unknown): Promise<{ body: Buffer; zstd: boolean }> {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  try {
    await runCommand('zstd', ['--version'], { timeoutMs: 3_000 });
    const tmp = path.join(env.WORKER_TMP_DIR, `art-${Date.now()}.json`);
    const out = `${tmp}.zst`;
    await mkdir(env.WORKER_TMP_DIR, { recursive: true });
    await writeFile(tmp, json);
    await runCommand('zstd', ['-f', '-q', '-o', out, tmp], { timeoutMs: 30_000 });
    const body = await readFile(out);
    await rm(tmp, { force: true });
    await rm(out, { force: true });
    return { body, zstd: true };
  } catch {
    return { body: gzipSync(json), zstd: false };
  }
}

function SOURCE_EXT(p: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java)$/i.test(p);
}

/**
 * Progressive tip-first delivery, then oldest→newest temporal deltas.
 *
 * 1. Parse tip → write temporal snapshot → graph_ready
 * 2. Walk remaining samples oldest→newest: incremental parse, S3 snapshots,
 *    deltas, Neo4j temporal edge updates, checkpoints every K
 * 3. Enqueue evolve
 */
export async function processParseCommitJob(payload: ParseCommitJobPayload) {
  const { withRepoNeo4jLock } = await import('./repo-lock');
  return withRepoNeo4jLock(payload.repoId, () => processParseCommitJobLocked(payload));
}

async function processParseCommitJobLocked(payload: ParseCommitJobPayload) {
  const log = logger.child({
    job_id: payload.jobId,
    run_id: payload.runId,
    repo_id: payload.repoId,
  });
  const config = SampleConfigSchema.parse(payload.sampleConfig ?? {});
  const sampleShas = payload.sampleShas;
  let workRoot: string | undefined;

  try {
    await patchRun(payload.runId, {
      status: 'parsing',
      jobStatus: 'active',
      progress: 5,
      commitsDone: 0,
      commitsTotal: sampleShas.length,
    });

    const opened = await openBareFromCloneUri(payload.cloneUri);
    workRoot = opened.workRoot;
    const { bareDir } = opened;
    const s3 = createS3();
    await ensureBucket(s3);

    const tipSha = sampleShas[sampleShas.length - 1]!;
    const tipTopo = sampleShas.length - 1;

    // --- Tip first (progressive) ---
    const tipGraph = await parseAndBuildGraph({
      bareDir,
      workRoot,
      s3,
      orgId: payload.orgId,
      repoId: payload.repoId,
      sha: tipSha,
      analyzerVersion: payload.analyzerVersion,
      parentSha: null,
      priorPaths: null,
    });

    await uploadSnapshot(s3, payload.orgId, payload.repoId, tipSha, tipGraph.snapshot);
    const tipArtifactUri = graphSnapshotKey(payload.orgId, payload.repoId, tipSha);
    await apiJson(`/v1/internal/repos/${payload.repoId}/graph/temporal-snapshot`, {
      method: 'POST',
      body: {
        sha: tipSha,
        topoIndex: tipTopo,
        analyzerVersion: payload.analyzerVersion,
        artifactUri: tipArtifactUri,
        replaceRepo: true,
      },
    });

    await patchRun(payload.runId, {
      status: 'graph_ready',
      commitSha: tipSha,
      commitsDone: 1,
      progress: Math.round((1 / sampleShas.length) * 40),
    });
    log.info({ tipSha }, 'tip graph_ready (progressive)');

    // --- Oldest → newest (including tip again for delta consistency) ---
    let prevSnapshot: GraphSnapshot | null = null;
    let prevSha: string | null = null;
    let priorPaths: Set<string> | null = null;
    /** Reverse import index: export fqn / file path → importers (file ids). */
    let reverseImports = new Map<string, Set<string>>();

    for (let i = 0; i < sampleShas.length; i++) {
      const sha = sampleShas[i]!;
      const parentSha = i === 0 ? null : sampleShas[i - 1]!;

      const parsed = await parseAndBuildGraph({
        bareDir,
        workRoot,
        s3,
        orgId: payload.orgId,
        repoId: payload.repoId,
        sha,
        analyzerVersion: payload.analyzerVersion,
        parentSha,
        priorPaths,
        reverseImports,
      });

      priorPaths = new Set(parsed.filePaths);
      reverseImports = parsed.reverseImports;

      await uploadSnapshot(s3, payload.orgId, payload.repoId, sha, parsed.snapshot);

      if (prevSnapshot && prevSha) {
        const renameMap = new Map<string, string>();
        for (const [from, to] of parsed.renames) {
          renameMap.set(`file:${from}`, `file:${to}`);
        }
        const diff = diffGraphs(prevSnapshot, parsed.snapshot, { renameMap });

        const deltaKey = graphDeltaKey(payload.orgId, payload.repoId, prevSha, sha).replace(
          /\.json\.gz$/,
          '',
        );
        const packed = await compressJson(diff);
        const deltaUri = packed.zstd ? `${deltaKey}.json.zst` : `${deltaKey}.json.gz`;
        await uploadBuffer(
          s3,
          deltaUri,
          packed.body,
          packed.zstd ? 'application/zstd' : 'application/gzip',
        );

        await apiJson(`/v1/internal/repos/${payload.repoId}/graph/delta`, {
          method: 'POST',
          body: {
            runId: payload.runId,
            fromSha: prevSha,
            toSha: sha,
            fromTopo: i - 1,
            toTopo: i,
            artifactUri: deltaUri,
            snapshotUri: graphSnapshotKey(payload.orgId, payload.repoId, sha),
            analyzerVersion: payload.analyzerVersion,
            nodesAdded: diff.nodesAdded.length,
            nodesRemoved: diff.nodesRemoved.length,
            edgesAddedCount: diff.edgesAdded.length,
            edgesRemovedCount: diff.edgesRemoved.length,
            renames: parsed.renames.map(([from, to]) => ({
              fromPath: from,
              toPath: to,
              confidence: 1,
              source: 'git_rename',
            })),
          },
        });

        if (i > 0 && i % config.checkpointEvery === 0) {
          const ckptBase = graphCheckpointKey(payload.orgId, payload.repoId, sha).replace(
            /\.json\.gz$/,
            '',
          );
          const ckpt = await compressJson(parsed.snapshot);
          const ckptUri = ckpt.zstd ? `${ckptBase}.json.zst` : `${ckptBase}.json.gz`;
          await uploadBuffer(
            s3,
            ckptUri,
            ckpt.body,
            ckpt.zstd ? 'application/zstd' : 'application/gzip',
          );
          await apiJson(`/v1/internal/repos/${payload.repoId}/graph/checkpoint`, {
            method: 'POST',
            body: {
              runId: payload.runId,
              sha,
              topoIndex: i,
              artifactUri: ckptUri,
            },
          });
        }
      } else if (i === 0 && sha !== tipSha) {
        // Oldest sample: seed temporal edges if tip was already written —
        // edges present at oldest get valid_from lowered via delta path on next hops.
        // For oldest-only bootstrap when tip ≠ oldest, write open edges at this topo.
        await apiJson(`/v1/internal/repos/${payload.repoId}/graph/temporal-bootstrap`, {
          method: 'POST',
          body: {
            sha,
            topoIndex: i,
            analyzerVersion: payload.analyzerVersion,
            artifactUri: graphSnapshotKey(payload.orgId, payload.repoId, sha),
          },
        });
      }

      prevSnapshot = parsed.snapshot;
      prevSha = sha;

      const done = i + 1;
      await patchRun(payload.runId, {
        status: sha === tipSha ? 'graph_ready' : 'parsing',
        commitsDone: done,
        progress: Math.min(95, Math.round((done / sampleShas.length) * 90)),
      });
      log.info({ sha, i, total: sampleShas.length }, 'sample parsed');
    }

    await apiJson(`/v1/internal/runs/${payload.runId}/enqueue-metrics`, {
      method: 'POST',
      body: {
        sampleShas,
        sampleConfig: config,
      },
    });

    await patchRun(payload.runId, {
      status: 'graph_ready',
      jobStatus: 'completed',
      progress: 100,
      commitsDone: sampleShas.length,
    });
    log.info('parse_commit done; metrics enqueued');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'parse_commit failed');
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

async function uploadSnapshot(
  s3: ReturnType<typeof createS3>,
  orgId: string,
  repoId: string,
  sha: string,
  snapshot: GraphSnapshot,
) {
  const key = graphSnapshotKey(orgId, repoId, sha);
  await uploadBuffer(
    s3,
    key,
    Buffer.from(JSON.stringify(snapshot), 'utf8'),
    'application/json',
  );
  // Legacy path for migration reads
  const alt = `graphs/${repoId}/snapshots/${sha}.json`;
  await uploadBuffer(
    s3,
    alt,
    Buffer.from(JSON.stringify(snapshot), 'utf8'),
    'application/json',
  );
}

async function parseAndBuildGraph(opts: {
  bareDir: string;
  workRoot: string;
  s3: ReturnType<typeof createS3>;
  orgId: string;
  repoId: string;
  sha: string;
  analyzerVersion: string;
  parentSha: string | null;
  priorPaths: Set<string> | null;
  reverseImports?: Map<string, Set<string>>;
}): Promise<{
  snapshot: GraphSnapshot;
  filePaths: string[];
  renames: Array<[string, string]>;
  reverseImports: Map<string, Set<string>>;
}> {
  const treeDir = path.join(opts.workRoot, `tree-${opts.sha.slice(0, 12)}`);
  await rm(treeDir, { recursive: true, force: true }).catch(() => undefined);
  await materializeWorktree(opts.bareDir, treeDir, opts.sha);

  // Optional SCIP precision (never runs untrusted builds)
  if (!opts.parentSha) {
    const { maybeRunScip } = await import('./scip');
    const scip = await maybeRunScip({
      enabled: process.env.SCIP_ENABLED === 'true',
      worktree: treeDir,
      languages: ['typescript', 'javascript', 'go'],
    });
    if (scip.attempted) {
      logger.info({ scip }, 'SCIP precision path considered');
    }
    if (scip.invoked && scip.indexPath) {
      await apiJson(`/v1/internal/repos/${opts.repoId}/precision`, {
        method: 'POST',
        body: {
          precisionMode: 'scip',
          language: scip.language ?? null,
          reason: scip.reason,
        },
      }).catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to persist precision_mode',
        );
      });
    }
  }

  let changedPaths: Set<string> | null = null;
  const renames: Array<[string, string]> = [];

  if (opts.parentSha) {
    const diffRes = await gwiGit([
      'diff-tree',
      '--path',
      opts.bareDir,
      '--from',
      opts.parentSha,
      '--to',
      opts.sha,
    ]);
    changedPaths = new Set();
    for (const line of diffRes.stdout.split('\n')) {
      if (!line.trim()) continue;
      const d = JSON.parse(line) as DiffEntry;
      if (!SOURCE_EXT(d.path) && !(d.old_path && SOURCE_EXT(d.old_path))) continue;
      if (d.status === 'R' && d.old_path) {
        renames.push([d.old_path, d.path]);
        changedPaths.add(d.path);
        changedPaths.add(d.old_path);
      } else if (d.status === 'D') {
        changedPaths.add(d.path);
      } else {
        changedPaths.add(d.path);
      }
    }
    // Invalidate importers of changed exports
    if (opts.reverseImports) {
      for (const p of [...changedPaths]) {
        const importers = opts.reverseImports.get(p);
        if (importers) for (const imp of importers) changedPaths.add(imp.replace(/^file:/, ''));
      }
    }
  }

  const parseOut = await runBin(env.GWI_PARSE_BIN, ['dir', '--root', treeDir]);
  const lines = parseOut.stdout.split('\n').filter((l) => l.trim());
  const results: FileParseResult[] = [];

  for (const line of lines) {
    const parsed = JSON.parse(line) as FileParseResult;
    if (!parsed.file?.path) continue;
    if (changedPaths && !changedPaths.has(parsed.file.path)) {
      // Still need full graph — load from cache by oid when possible
    }

    let oid = '';
    try {
      const oidRes = await gwiGit([
        'blob-oid',
        '--path',
        opts.bareDir,
        '--sha',
        opts.sha,
        '--file',
        parsed.file.path,
      ]);
      oid = oidRes.stdout.trim();
    } catch {
      oid = createHash('sha1').update(parsed.file.path).digest('hex');
    }

    const mustParse =
      !changedPaths ||
      changedPaths.has(parsed.file.path) ||
      !opts.parentSha;

    if (!mustParse && oid) {
      const cached = await loadParseCache(opts.s3, opts.orgId, oid);
      if (cached && cached.analyzer_version === opts.analyzerVersion) {
        results.push(cached);
        continue;
      }
    }

    // Prefer cache even on mustParse when oid unchanged
    if (oid) {
      const cached = await loadParseCache(opts.s3, opts.orgId, oid);
      if (cached && cached.analyzer_version === opts.analyzerVersion) {
        results.push(cached);
        continue;
      }
    }

    results.push(parsed);
    if (oid) await storeParseCache(opts.s3, opts.orgId, oid, parsed);
  }

  // Entity upsert for this commit
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

  const batchSize = 200;
  for (let i = 0; i < entityPayload.length; i += batchSize) {
    const batch = entityPayload.slice(i, i + batchSize);
    await apiJson(`/v1/internal/repos/${opts.repoId}/entities/upsert`, {
      method: 'POST',
      body: {
        commitSha: opts.sha,
        analyzerVersion: opts.analyzerVersion,
        entities: batch,
      },
    });
  }

  if (renames.length) {
    await apiJson(`/v1/internal/repos/${opts.repoId}/entities/renames`, {
      method: 'POST',
      body: {
        fromSha: opts.parentSha,
        toSha: opts.sha,
        renames: renames.map(([fromPath, toPath]) => ({
          fromPath,
          toPath,
          confidence: 1,
          source: 'git_rename',
        })),
      },
    });
  }

  const parseJsonl = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const linked = await runBin(env.GWI_LINK_BIN, ['jsonl', '--root', treeDir], {
    input: parseJsonl,
  });
  const graph = await runBin(
    env.GWI_GRAPH_BIN,
    [
      'build',
      '--repo-id',
      opts.repoId,
      '--sha',
      opts.sha,
      '--analyzer-version',
      opts.analyzerVersion,
    ],
    { input: linked.stdout },
  );

  const snapshot = JSON.parse(graph.stdout) as GraphSnapshot;
  // Normalize sha field
  snapshot.sha = opts.sha;

  const reverseImports = new Map<string, Set<string>>();
  for (const e of snapshot.edges as GraphEdge[]) {
    if (e.rel !== 'IMPORTS' && e.rel !== 'DEPENDS_ON') continue;
    const set = reverseImports.get(e.to) ?? new Set();
    set.add(e.from);
    reverseImports.set(e.to, set);
  }

  await rm(treeDir, { recursive: true, force: true }).catch(() => undefined);

  return {
    snapshot,
    filePaths: results.map((r) => r.file.path),
    renames,
    reverseImports,
  };
}
