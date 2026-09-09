/**
 * Optional SCIP precision path (Phase 5).
 * Never runs untrusted project build scripts — only allowlisted indexer invokes
 * when lockfiles + safe patterns exist, else skip and keep tree-sitter.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger';

export type ScipAttempt = {
  attempted: boolean;
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

export async function maybeRunScip(opts: {
  enabled: boolean;
  worktree: string;
  languages: string[];
}): Promise<ScipAttempt> {
  if (!opts.enabled) {
    return { attempted: false, reason: 'scip_enabled=false' };
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
        language: 'typescript',
        reason: 'no allowlisted lockfile; skip scip-typescript',
      };
    }
    // Safe invoke policy: do not shell out to npm scripts. Indexer must be
    // preinstalled on the worker image and run with --skip-git etc.
    logger.info(
      { worktree: opts.worktree },
      'SCIP TS path eligible — indexer invoke deferred to worker image binary',
    );
    return {
      attempted: true,
      language: 'typescript',
      reason: 'eligible; invoke scip-typescript from allowlisted worker binary only',
    };
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
        language: 'go',
        reason: 'missing go.mod/go.sum; skip scip-go',
      };
    }
    return {
      attempted: true,
      language: 'go',
      reason: 'eligible; invoke scip-go from allowlisted worker binary only',
    };
  }

  return { attempted: false, reason: 'no SCIP-supported language in sample' };
}
