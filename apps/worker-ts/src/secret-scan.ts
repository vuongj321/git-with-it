/**
 * Secret scanning on clone (Phase 5).
 * Prefer gitleaks when on PATH; falls back to high-signal regex heuristics.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './git';
import { logger } from './logger';
import { env } from './env';

export type SecretFinding = {
  rule: string;
  file: string;
  severity: 'high' | 'medium' | 'low';
};

export type SecretScanResult = {
  mode: 'off' | 'warn' | 'block';
  findings: SecretFinding[];
  blocked: boolean;
};

const HIGH_PATTERNS: { rule: string; re: RegExp }[] = [
  { rule: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { rule: 'github-pat', re: /ghp_[A-Za-z0-9]{36}/g },
  { rule: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  {
    rule: 'generic-secret-assignment',
    re: /(?:api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
  },
];

async function gitleaksAvailable(): Promise<boolean> {
  try {
    await runCommand('gitleaks', ['version'], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function scanSecrets(bareOrWorktree: string): Promise<SecretScanResult> {
  const mode = env.SECRET_SCAN_MODE;
  if (mode === 'off') {
    return { mode, findings: [], blocked: false };
  }

  const findings: SecretFinding[] = [];

  if (await gitleaksAvailable()) {
    try {
      // gitleaks exits 1 when secrets found
      await runCommand(
        'gitleaks',
        ['detect', '--source', bareOrWorktree, '--no-git', '-f', 'json', '-r', '/dev/stdout'],
        { timeoutMs: 120_000 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Best-effort parse: count as one high finding if gitleaks reported leaks
      if (/leaks|findings|secrets/i.test(msg) || /exit.*1/.test(msg)) {
        findings.push({
          rule: 'gitleaks',
          file: bareOrWorktree,
          severity: 'high',
        });
      }
      logger.warn({ err: msg }, 'gitleaks scan finished with findings or error');
    }
  } else {
    // Heuristic scan of a few likely files at repo root if worktree; skip deep walk for MVP
    const candidates = ['README.md', '.env', '.env.example', 'config.json', 'secrets.yaml'];
    for (const rel of candidates) {
      const full = path.join(bareOrWorktree, rel);
      try {
        await access(full);
        const { readFile } = await import('node:fs/promises');
        const text = await readFile(full, 'utf8');
        for (const { rule, re } of HIGH_PATTERNS) {
          if (re.test(text)) {
            findings.push({ rule, file: rel, severity: 'high' });
          }
          re.lastIndex = 0;
        }
      } catch {
        // missing file ok
      }
    }
  }

  const high = findings.filter((f) => f.severity === 'high');
  const blocked = mode === 'block' && high.length > 0;
  if (findings.length) {
    logger.warn({ findings, blocked, mode }, 'secret scan results');
  }
  return { mode, findings, blocked };
}
