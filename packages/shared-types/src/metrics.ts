/**
 * Architectural metrics catalog (Phase 3).
 * Computed from a GraphSnapshot at a sampled SHA so metrics stay aligned with the graph.
 *
 * complexity_proxy: decision-node approximation (if/while/case/&&/||), not full McCabe.
 * maintainability_proxy: see ADR 0013 — weighted combo for heatmaps only.
 */

import { entityId, type EntityKindForId } from './entity-id';
import { findSccs, type GraphEdge, type GraphNode, type GraphSnapshot } from './graph-diff';

export const METRIC_NAMES = [
  'loc',
  'file_size',
  'fan_in',
  'fan_out',
  'dependency_count',
  'cycle_member',
  'cycle_count',
  'complexity_proxy',
  'churn',
  'maintainability_proxy',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export type FileStat = {
  /** Lines of code from appearance / parse. */
  loc?: number;
  /** Approximate decision-node count (if/while/for/case/catch/&&/||/?). */
  complexityProxy?: number;
  /** Blobs touched in a churn window (optional). */
  churn?: number;
  /** Byte size when available. */
  fileSize?: number;
};

export type MetricRow = {
  repoId: string;
  commitSha: string;
  topoIndex: number;
  authoredAt: string | null;
  entityId: string;
  entityKind: string;
  metric: MetricName;
  value: number;
};

export type ComputeMetricsInput = {
  repoId: string;
  snapshot: GraphSnapshot;
  topoIndex: number;
  authoredAt?: string | null;
  /** Optional per-file-path stats (path → stats). */
  fileStats?: Record<string, FileStat>;
};

function kindForId(kind: string): EntityKindForId {
  if (kind === 'package') return 'package';
  if (kind === 'file') return 'file';
  if (kind === 'class') return 'class';
  if (kind === 'interface') return 'interface';
  if (kind === 'function') return 'function';
  if (kind === 'method') return 'method';
  return 'variable';
}

function stableEntityId(repoId: string, node: GraphNode): string {
  return entityId(repoId, kindForId(node.kind), node.fqn);
}

function degreeMaps(edges: GraphEdge[], rels: string[]) {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const e of edges) {
    if (!rels.includes(e.rel)) continue;
    fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
    fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
  }
  return { fanIn, fanOut };
}

/** Distinct outbound DEPENDS_ON targets (dependency_count). */
function dependencyCount(edges: GraphEdge[], fromId: string): number {
  const targets = new Set<string>();
  for (const e of edges) {
    if (e.from !== fromId) continue;
    if (e.rel !== 'DEPENDS_ON' && e.rel !== 'IMPORTS') continue;
    targets.add(e.to);
  }
  return targets.size;
}

/**
 * Maintainability proxy (0–100, higher = healthier).
 * ADR 0013: 100 - clamp(0.4*c_n + 0.3*fi_n + 0.3*loc_n, 0, 100)
 * where *_n are min-max normalized within the SHA cohort (files only).
 */
export function maintainabilityProxy(opts: {
  complexity: number;
  fanIn: number;
  loc: number;
  maxComplexity: number;
  maxFanIn: number;
  maxLoc: number;
}): number {
  const cN = opts.maxComplexity > 0 ? opts.complexity / opts.maxComplexity : 0;
  const fiN = opts.maxFanIn > 0 ? opts.fanIn / opts.maxFanIn : 0;
  const locN = opts.maxLoc > 0 ? opts.loc / opts.maxLoc : 0;
  const burden = 0.4 * cN + 0.3 * fiN + 0.3 * locN;
  return Math.max(0, Math.min(100, 100 - burden * 100));
}

/** Count decision-ish tokens in source text (complexity_proxy). */
export function complexityProxyFromSource(source: string): number {
  const patterns = [
    /\bif\b/g,
    /\belse\b/g,
    /\bwhile\b/g,
    /\bfor\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\b\?\./g,
    /\?\?/g,
    /&&/g,
    /\|\|/g,
    /\?/g,
  ];
  let n = 0;
  for (const re of patterns) {
    const m = source.match(re);
    if (m) n += m.length;
  }
  return n;
}

export function computeMetrics(input: ComputeMetricsInput): MetricRow[] {
  const { repoId, snapshot, topoIndex } = input;
  const authoredAt = input.authoredAt ?? null;
  const fileStats = input.fileStats ?? {};
  const nodes = snapshot.nodes;
  const edges = snapshot.edges;

  const packageNodes = nodes.filter((n) => n.kind === 'package');
  const fileNodes = nodes.filter((n) => n.kind === 'file');
  const pkgIdSet = new Set(packageNodes.map((n) => n.id));

  const depEdges = edges.filter(
    (e) => e.rel === 'DEPENDS_ON' || e.rel === 'IMPORTS',
  );
  const pkgEdges = depEdges.filter(
    (e) => pkgIdSet.has(e.from) && pkgIdSet.has(e.to),
  );
  const cycleEdges = pkgEdges.length > 0 ? pkgEdges : depEdges;
  const cycleNodeIds =
    pkgEdges.length > 0
      ? packageNodes.map((n) => n.id)
      : nodes.map((n) => n.id);
  const sccs = findSccs(cycleEdges, cycleNodeIds);

  const cycleMember = new Map<string, number>();
  sccs.forEach((scc, idx) => {
    for (const id of scc) cycleMember.set(id, idx + 1);
  });

  const { fanIn: pkgFanIn, fanOut: pkgFanOut } = degreeMaps(
    pkgEdges.length > 0 ? pkgEdges : depEdges,
    ['DEPENDS_ON', 'IMPORTS'],
  );

  const { fanIn: fileFanIn, fanOut: fileFanOut } = degreeMaps(edges, [
    'DEPENDS_ON',
    'IMPORTS',
  ]);

  const rows: MetricRow[] = [];

  const push = (
    node: GraphNode | null,
    entityKind: string,
    eid: string,
    metric: MetricName,
    value: number,
  ) => {
    rows.push({
      repoId,
      commitSha: snapshot.sha,
      topoIndex,
      authoredAt,
      entityId: eid,
      entityKind,
      metric,
      value,
    });
    void node;
  };

  // Repo-level cycle_count
  push(null, 'repo', repoId, 'cycle_count', sccs.length);

  for (const n of packageNodes) {
    const eid = stableEntityId(repoId, n);
    const fi = pkgFanIn.get(n.id) ?? 0;
    const fo = pkgFanOut.get(n.id) ?? 0;
    push(n, 'package', eid, 'fan_in', fi);
    push(n, 'package', eid, 'fan_out', fo);
    push(n, 'package', eid, 'dependency_count', dependencyCount(edges, n.id));
    push(n, 'package', eid, 'cycle_member', cycleMember.has(n.id) ? 1 : 0);
  }

  // Precompute maxes for maintainability normalization
  let maxComplexity = 1;
  let maxFanIn = 1;
  let maxLoc = 1;
  const fileMeta = fileNodes.map((n) => {
    const path = n.path ?? n.fqn;
    const stats = fileStats[path] ?? {};
    const loc = stats.loc ?? 0;
    const complexity = stats.complexityProxy ?? 0;
    const fi = fileFanIn.get(n.id) ?? 0;
    maxComplexity = Math.max(maxComplexity, complexity);
    maxFanIn = Math.max(maxFanIn, fi);
    maxLoc = Math.max(maxLoc, loc);
    return { n, path, stats, loc, complexity, fi };
  });

  for (const { n, path, stats, loc, complexity, fi } of fileMeta) {
    const eid = stableEntityId(repoId, n);
    const fo = fileFanOut.get(n.id) ?? 0;
    push(n, 'file', eid, 'fan_in', fi);
    push(n, 'file', eid, 'fan_out', fo);
    push(n, 'file', eid, 'loc', loc);
    if (stats.fileSize != null) {
      push(n, 'file', eid, 'file_size', stats.fileSize);
    }
    push(n, 'file', eid, 'complexity_proxy', complexity);
    if (stats.churn != null) {
      push(n, 'file', eid, 'churn', stats.churn);
    }
    push(
      n,
      'file',
      eid,
      'maintainability_proxy',
      maintainabilityProxy({
        complexity,
        fanIn: fi,
        loc,
        maxComplexity,
        maxFanIn,
        maxLoc,
      }),
    );
    void path;
  }

  return rows;
}

export type MetricsSummary = {
  sha: string;
  cycleCount: number;
  packageCount: number;
  fileCount: number;
  avgFanIn: number;
  avgComplexity: number;
  totalLoc: number;
};

export function summarizeMetrics(
  rows: MetricRow[],
  sha: string,
): MetricsSummary {
  const atSha = rows.filter((r) => r.commitSha === sha);
  const cycleCount =
    atSha.find((r) => r.metric === 'cycle_count' && r.entityKind === 'repo')
      ?.value ?? 0;
  const packages = new Set(
    atSha.filter((r) => r.entityKind === 'package').map((r) => r.entityId),
  );
  const files = new Set(
    atSha.filter((r) => r.entityKind === 'file').map((r) => r.entityId),
  );
  const fanIns = atSha.filter(
    (r) => r.metric === 'fan_in' && r.entityKind === 'package',
  );
  const complexities = atSha.filter((r) => r.metric === 'complexity_proxy');
  const locs = atSha.filter((r) => r.metric === 'loc');
  const avg = (xs: MetricRow[]) =>
    xs.length ? xs.reduce((s, r) => s + r.value, 0) / xs.length : 0;

  return {
    sha,
    cycleCount,
    packageCount: packages.size,
    fileCount: files.size,
    avgFanIn: avg(fanIns),
    avgComplexity: avg(complexities),
    totalLoc: locs.reduce((s, r) => s + r.value, 0),
  };
}
