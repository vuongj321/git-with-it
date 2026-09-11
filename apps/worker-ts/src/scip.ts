/**
 * Optional SCIP precision path (Phase 5).
 * Never runs untrusted project build scripts — only allowlisted indexer invokes
 * when lockfiles + safe patterns exist, else skip and keep tree-sitter.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './git';
import { logger } from './logger';

export type ScipAttempt = {
  attempted: boolean;
  invoked: boolean;
  language?: 'typescript' | 'go';
  reason: string;
  indexPath?: string;
};

const SAFE_TS_MARKERS = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
const SAFE_GO_MARKERS = ['go.sum', 'go.mod'];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function which(bin: string): Promise<string | null> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const res = await runCommand(cmd, [bin], { timeoutMs: 5_000 });
    const line = res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return line || null;
  } catch {
    return null;
  }
}

/**
 * Attempt allowlisted SCIP indexer. Sets precision to SCIP only when index is produced.
 */
export async function maybeRunScip(opts: {
  enabled: boolean;
  worktree: string;
  languages: string[];
}): Promise<ScipAttempt> {
  if (!opts.enabled) {
    return { attempted: false, invoked: false, reason: 'scip_enabled=false' };
  }

  const hasTs = opts.languages.some((l) =>
    ['typescript', 'javascript'].includes(l),
  );
  const hasGo = opts.languages.includes('go');

  if (hasTs) {
    const lockOk = (
      await Promise.all(
        SAFE_TS_MARKERS.map((m) => exists(path.join(opts.worktree, m))),
      )
    ).some(Boolean);
    if (!lockOk) {
      return {
        attempted: false,
        invoked: false,
        language: 'typescript',
        reason: 'no allowlisted lockfile; skip scip-typescript',
      };
    }

    const bin =
      process.env.SCIP_TYPESCRIPT_BIN ||
      (await which('scip-typescript')) ||
      null;
    if (!bin) {
      return {
        attempted: true,
        invoked: false,
        language: 'typescript',
        reason: 'eligible but scip-typescript binary not on PATH',
      };
    }

    const indexPath = path.join(opts.worktree, 'index.scip');
    try {
      // Allowlisted args only — never `npm run` / project scripts.
      await runCommand(
        bin,
        ['index', '--cwd', opts.worktree, '--output', indexPath],
        { timeoutMs: 600_000 },
      );
      const wrote = await exists(indexPath);
      logger.info({ bin, wrote }, 'SCIP typescript indexer finished');
      return {
        attempted: true,
        invoked: true,
        language: 'typescript',
        reason: wrote
          ? 'scip-typescript index written'
          : 'scip-typescript exited without index file',
        indexPath: wrote ? indexPath : undefined,
      };
    } catch (err) {
      return {
        attempted: true,
        invoked: true,
        language: 'typescript',
        reason: `scip-typescript failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (hasGo) {
    const modOk = (
      await Promise.all(
        SAFE_GO_MARKERS.map((m) => exists(path.join(opts.worktree, m))),
      )
    ).every(Boolean);
    if (!modOk) {
      return {
        attempted: false,
        invoked: false,
        language: 'go',
        reason: 'missing go.mod/go.sum; skip scip-go',
      };
    }

    const bin = process.env.SCIP_GO_BIN || (await which('scip-go')) || null;
    if (!bin) {
      return {
        attempted: true,
        invoked: false,
        language: 'go',
        reason: 'eligible but scip-go binary not on PATH',
      };
    }

    const indexPath = path.join(opts.worktree, 'index.scip');
    try {
      await runCommand(
        bin,
        ['--cwd', opts.worktree, '--output', indexPath],
        { timeoutMs: 600_000 },
      );
      const wrote = await exists(indexPath);
      return {
        attempted: true,
        invoked: true,
        language: 'go',
        reason: wrote ? 'scip-go index written' : 'scip-go exited without index file',
        indexPath: wrote ? indexPath : undefined,
      };
    } catch (err) {
      return {
        attempted: true,
        invoked: true,
        language: 'go',
        reason: `scip-go failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    attempted: false,
    invoked: false,
    reason: 'no SCIP-supported language in sample',
  };
}
