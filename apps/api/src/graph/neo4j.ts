import neo4j, { type Driver } from 'neo4j-driver';
import { env } from '../config/env';

let driver: Driver | null = null;

/** Exclusive upper bound for "still valid" edges. */
export const VALID_TO_OPEN = 2_147_483_647;

export function neo4jDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      env.NEO4J_URI,
      neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
    );
  }
  return driver;
}

export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export type GraphNodeInput = {
  id: string;
  kind: string;
  fqn: string;
  name: string;
  path?: string | null;
  language?: string | null;
  package?: string | null;
};

export type GraphEdgeInput = {
  from: string;
  to: string;
  rel: string;
};

/**
 * Ensure one node per entity id (repo-scoped). Presence tracked via edge validity
 * and PRESENT_IN relationships.
 */
export async function upsertTemporalNodes(opts: {
  repoId: string;
  analyzerVersion: string;
  nodes: GraphNodeInput[];
}) {
  const session = neo4jDriver().session();
  try {
    await session.executeWrite(async (tx) => {
      for (const node of opts.nodes) {
        const label = sanitizeLabel(node.kind);
        await tx.run(
          `
          MERGE (n:${label} {repo_id: $repoId, id: $id})
          ON CREATE SET
            n.fqn = $fqn,
            n.name = $name,
            n.kind = $kind,
            n.path = $path,
            n.language = $language,
            n.package = $package,
            n.analyzer_version = $analyzerVersion
          ON MATCH SET
            n.fqn = $fqn,
            n.name = $name,
            n.path = $path,
            n.language = $language,
            n.package = $package,
            n.analyzer_version = $analyzerVersion
          `,
          {
            id: node.id,
            repoId: opts.repoId,
            fqn: node.fqn,
            name: node.name,
            kind: node.kind,
            path: node.path ?? null,
            language: node.language ?? null,
            package: node.package ?? null,
            analyzerVersion: opts.analyzerVersion,
          },
        );
      }
    });
  } finally {
    await session.close();
  }
}

/**
 * Apply edge delta at topo index: close removed edges, open added edges.
 * Single-writer-per-repo is enforced by the worker queue concurrency.
 */
export async function applyTemporalEdgeDelta(opts: {
  repoId: string;
  sha: string;
  topoIndex: number;
  analyzerVersion: string;
  edgesAdded: GraphEdgeInput[];
  edgesRemoved: GraphEdgeInput[];
}) {
  const session = neo4jDriver().session();
  const idx = neo4j.int(opts.topoIndex);
  try {
    await session.executeWrite(async (tx) => {
      for (const edge of opts.edgesRemoved) {
        const rel = sanitizeRel(edge.rel);
        await tx.run(
          `
          MATCH (a {repo_id: $repoId, id: $from})-[r:${rel}]->(b {repo_id: $repoId, id: $to})
          WHERE r.valid_to = $open
          SET r.valid_to = $idx, r.removed_in = $sha
          `,
          {
            repoId: opts.repoId,
            from: edge.from,
            to: edge.to,
            open: neo4j.int(VALID_TO_OPEN),
            idx,
            sha: opts.sha,
          },
        );
      }
      for (const edge of opts.edgesAdded) {
        const rel = sanitizeRel(edge.rel);
        await tx.run(
          `
          MATCH (a {repo_id: $repoId, id: $from})
          MATCH (b {repo_id: $repoId, id: $to})
          CREATE (a)-[r:${rel} {
            repo_id: $repoId,
            valid_from: $idx,
            valid_to: $open,
            added_in: $sha,
            analyzer_version: $analyzerVersion
          }]->(b)
          `,
          {
            repoId: opts.repoId,
            from: edge.from,
            to: edge.to,
            idx,
            open: neo4j.int(VALID_TO_OPEN),
            sha: opts.sha,
            analyzerVersion: opts.analyzerVersion,
          },
        );
      }
    });
  } finally {
    await session.close();
  }
}

/** Bootstrap temporal graph from a full snapshot at a given topo index (e.g. tip-first). */
export async function writeTemporalSnapshot(opts: {
  repoId: string;
  sha: string;
  topoIndex: number;
  analyzerVersion: string;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  /** When true, delete prior temporal graph for this repo first. */
  replaceRepo?: boolean;
}) {
  const session = neo4jDriver().session();
  const idx = neo4j.int(opts.topoIndex);
  try {
    await session.executeWrite(async (tx) => {
      if (opts.replaceRepo) {
        await tx.run(
          `
          MATCH (n {repo_id: $repoId})
          WHERE n.sha IS NULL OR n.id IS NOT NULL
          DETACH DELETE n
          `,
          { repoId: opts.repoId },
        );
        // Also clear legacy sha-tagged snapshots for this repo
        await tx.run(
          `
          MATCH (n {repo_id: $repoId})
          DETACH DELETE n
          `,
          { repoId: opts.repoId },
        );
      }

      for (const node of opts.nodes) {
        const label = sanitizeLabel(node.kind);
        await tx.run(
          `
          MERGE (n:${label} {repo_id: $repoId, id: $id})
          ON CREATE SET
            n.fqn = $fqn, n.name = $name, n.kind = $kind,
            n.path = $path, n.language = $language, n.package = $package,
            n.analyzer_version = $analyzerVersion
          ON MATCH SET
            n.fqn = $fqn, n.name = $name, n.path = $path,
            n.language = $language, n.package = $package,
            n.analyzer_version = $analyzerVersion
          `,
          {
            id: node.id,
            repoId: opts.repoId,
            fqn: node.fqn,
            name: node.name,
            kind: node.kind,
            path: node.path ?? null,
            language: node.language ?? null,
            package: node.package ?? null,
            analyzerVersion: opts.analyzerVersion,
          },
        );
      }

      for (const edge of opts.edges) {
        const rel = sanitizeRel(edge.rel);
        await tx.run(
          `
          MATCH (a {repo_id: $repoId, id: $from})
          MATCH (b {repo_id: $repoId, id: $to})
          CREATE (a)-[r:${rel} {
            repo_id: $repoId,
            valid_from: $idx,
            valid_to: $open,
            added_in: $sha,
            analyzer_version: $analyzerVersion
          }]->(b)
          `,
          {
            repoId: opts.repoId,
            from: edge.from,
            to: edge.to,
            idx,
            open: neo4j.int(VALID_TO_OPEN),
            sha: opts.sha,
            analyzerVersion: opts.analyzerVersion,
          },
        );
      }
    });
  } finally {
    await session.close();
  }
}

/** @deprecated Phase 1 API — delegates to temporal write at topo 0. */
export async function writeGraphSnapshot(opts: {
  repoId: string;
  sha: string;
  analyzerVersion: string;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
}) {
  await writeTemporalSnapshot({
    ...opts,
    topoIndex: 0,
    replaceRepo: true,
  });
}

export async function queryGraphSlice(opts: {
  repoId: string;
  sha: string;
  topoIndex?: number | null;
  view: 'package' | 'file';
  maxNodes: number;
  /** Entity id (graph node id) to center an ego-network expansion on. */
  focus?: string | null;
  /** Hop depth from focus (1–3). Ignored without focus. */
  depth?: number | null;
}) {
  const session = neo4jDriver().session();
  try {
    const kindFilter = opts.view === 'package' ? 'package' : 'file';
    const idx =
      opts.topoIndex === undefined || opts.topoIndex === null
        ? null
        : neo4j.int(opts.topoIndex);
    const focus = opts.focus?.trim() || null;
    const depth = Math.max(1, Math.min(3, opts.depth ?? 1));

    let result;
    if (focus) {
      // Ego network: hop count must be a literal in Cypher (clamped 1–3).
      // Match seed by id first (kind filter is applied to neighbors) so expand
      // still works if kind was missing on an older node write.
      const pattern = `[*0..${depth}]`;
      result =
        idx !== null
          ? await session.run(
              `
              MATCH (seed {repo_id: $repoId, id: $focus})
              WHERE seed.kind = $kind OR seed.kind IS NULL
              MATCH (seed)-${pattern}-(n {repo_id: $repoId})
              WHERE n.kind = $kind OR n = seed
              WITH DISTINCT n LIMIT $limit
              WITH collect(n) AS nodeList
              UNWIND nodeList AS n
              OPTIONAL MATCH (n)-[r]->(m {repo_id: $repoId})
              WHERE m IN nodeList
                AND (m.kind = $kind OR m = n)
                AND (r.valid_from IS NULL OR (r.valid_from <= $idx AND $idx < r.valid_to))
              RETURN n, r, m
              `,
              {
                repoId: opts.repoId,
                kind: kindFilter,
                focus,
                limit: neo4j.int(opts.maxNodes),
                idx,
              },
            )
          : await session.run(
              `
              MATCH (seed {repo_id: $repoId, id: $focus})
              WHERE seed.kind = $kind OR seed.kind IS NULL
              MATCH (seed)-${pattern}-(n {repo_id: $repoId})
              WHERE n.kind = $kind OR n = seed
              WITH DISTINCT n LIMIT $limit
              WITH collect(n) AS nodeList
              UNWIND nodeList AS n
              OPTIONAL MATCH (n)-[r]->(m {repo_id: $repoId})
              WHERE m IN nodeList
                AND (m.kind = $kind OR m = n)
                AND (r.sha = $sha OR r.sha IS NULL OR r.valid_to IS NOT NULL)
              RETURN n, r, m
              `,
              {
                repoId: opts.repoId,
                sha: opts.sha,
                kind: kindFilter,
                focus,
                limit: neo4j.int(opts.maxNodes),
              },
            );
    } else {
      // Prefer temporal filter when topoIndex known; else fall back to legacy sha tag
      result =
        idx !== null
          ? await session.run(
              `
              MATCH (n {repo_id: $repoId, kind: $kind})
              WITH n LIMIT $limit
              OPTIONAL MATCH (n)-[r]->(m {repo_id: $repoId, kind: $kind})
              WHERE r.valid_from <= $idx AND $idx < r.valid_to
              RETURN n, r, m
              `,
              {
                repoId: opts.repoId,
                kind: kindFilter,
                limit: neo4j.int(opts.maxNodes),
                idx,
              },
            )
          : await session.run(
              `
              MATCH (n {repo_id: $repoId, kind: $kind})
              WHERE n.sha = $sha OR n.sha IS NULL
              WITH n LIMIT $limit
              OPTIONAL MATCH (n)-[r]->(m {repo_id: $repoId, kind: $kind})
              WHERE (r.sha = $sha) OR (r.valid_to IS NOT NULL AND r.valid_from IS NOT NULL)
              RETURN n, r, m
              `,
              {
                repoId: opts.repoId,
                sha: opts.sha,
                kind: kindFilter,
                limit: neo4j.int(opts.maxNodes),
              },
            );
    }

    const nodes = new Map<string, Record<string, unknown>>();
    const edges: Array<{ from: string; to: string; rel: string }> = [];

    for (const record of result.records) {
      const n = record.get('n');
      if (n) {
        const props = n.properties as Record<string, unknown>;
        nodes.set(String(props.id), props);
      }
      const m = record.get('m');
      const r = record.get('r');
      if (m && r && n) {
        const mp = m.properties as Record<string, unknown>;
        nodes.set(String(mp.id), mp);
        edges.push({
          from: String((n.properties as Record<string, unknown>).id),
          to: String(mp.id),
          rel: r.type as string,
        });
      }
    }

    return {
      repoId: opts.repoId,
      sha: opts.sha,
      topoIndex: opts.topoIndex ?? null,
      view: opts.view,
      focus: focus,
      depth: focus ? depth : null,
      nodes: [...nodes.values()],
      edges,
      capped: nodes.size >= opts.maxNodes,
    };
  } finally {
    await session.close();
  }
}

function sanitizeLabel(kind: string): string {
  const map: Record<string, string> = {
    package: 'Package',
    file: 'File',
    class: 'Class',
    interface: 'Interface',
    function: 'Function',
    method: 'Method',
    variable: 'Variable',
  };
  return map[kind.toLowerCase()] ?? 'Entity';
}

function sanitizeRel(rel: string): string {
  const allowed = new Set(['CONTAINS', 'IMPORTS', 'DEPENDS_ON']);
  const upper = rel.toUpperCase();
  return allowed.has(upper) ? upper : 'DEPENDS_ON';
}
