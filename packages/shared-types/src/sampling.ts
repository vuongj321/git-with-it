/**
 * First-parent commit sampling policy (ADR 0008).
 *
 * Always include tip; last N commits; plus one calendar-month anchor
 * outside the recent window when monthlyAnchors is enabled.
 */

export type WalkedCommit = {
  sha: string;
  parentShas: string[];
  authoredAt: Date | null;
  message: string;
  /** Index from tip: 0 = tip, 1 = tip's first parent, … */
  depthFromTip: number;
};

export type SamplePolicy = {
  lastN: number;
  monthlyAnchors: boolean;
};

export type SampledCommit = WalkedCommit & {
  /** Monotonic oldest→newest index among the sampled set (0 = oldest sample). */
  topoIndex: number;
  reason: 'tip' | 'window' | 'monthly_anchor';
};

/**
 * `walked` must be tip-first (depthFromTip ascending: tip at index 0).
 * Returns samples ordered oldest→newest with monotonic topoIndex.
 */
export function sampleFirstParentCommits(
  walked: WalkedCommit[],
  policy: SamplePolicy,
): SampledCommit[] {
  if (walked.length === 0) return [];

  const selected = new Map<string, { commit: WalkedCommit; reason: SampledCommit['reason'] }>();

  const tip = walked[0]!;
  selected.set(tip.sha, { commit: tip, reason: 'tip' });

  for (const c of walked) {
    if (c.depthFromTip < policy.lastN) {
      if (!selected.has(c.sha)) {
        selected.set(c.sha, { commit: c, reason: 'window' });
      }
    }
  }

  if (policy.monthlyAnchors) {
    const seenMonths = new Set<string>();
    for (const c of walked) {
      if (!c.authoredAt) continue;
      const key = `${c.authoredAt.getUTCFullYear()}-${c.authoredAt.getUTCMonth()}`;
      if (seenMonths.has(key)) continue;
      seenMonths.add(key);
      // Prefer the newest commit of each month that is outside the window,
      // but also anchor months that only appear deeper than lastN.
      if (c.depthFromTip >= policy.lastN && !selected.has(c.sha)) {
        selected.set(c.sha, { commit: c, reason: 'monthly_anchor' });
      }
    }
    // Also mark one tip-side commit per month inside the window as already covered
    // by walking tip→past: first time we see a month near tip is the month's tip-side.
  }

  const ordered = [...selected.values()]
    .map((s) => s)
    .sort((a, b) => {
      // Oldest first: higher depthFromTip first; tip last
      if (b.commit.depthFromTip !== a.commit.depthFromTip) {
        return b.commit.depthFromTip - a.commit.depthFromTip;
      }
      return a.commit.sha.localeCompare(b.commit.sha);
    });

  return ordered.map((s, i) => ({
    ...s.commit,
    topoIndex: i,
    reason: s.reason,
  }));
}
