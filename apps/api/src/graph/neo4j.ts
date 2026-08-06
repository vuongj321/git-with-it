import neo4j, { type Driver } from 'neo4j-driver';
import { env } from '../config/env';

let driver: Driver | null = null;

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

/** Replace sha-tagged snapshot for (repoId, sha). */
export async function writeGraphSnapshot(opts: {
  repoId: string;
  sha: string;
  analyzerVersion: string;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
}) {
  const session = neo4jDriver().session();
  try {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MATCH (n {repo_id: $repoId, sha: $sha})
        DETACH DELETE n
        `,
        { repoId: opts.repoId, sha: opts.sha },
      );

      for (const node of opts.nodes) {
        const label = sanitizeLabel(node.kind);
        await tx.run(
          `
          CREATE (n:${label} {
            id: $id,
            repo_id: $repoId,
            sha: $sha,
            fqn: $fqn,
            name: $name,
            kind: $kind,
            path: $path,
            language: $language,
            package: $package,
            analyzer_version: $analyzerVersion
          })
          `,
          {
            id: node.id,
            repoId: opts.repoId,
            sha: opts.sha,
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
          MATCH (a {repo_id: $repoId, sha: $sha, id: $from})
          MATCH (b {repo_id: $repoId, sha: $sha, id: $to})
          CREATE (a)-[r:${rel} {
            repo_id: $repoId,
            sha: $sha,
            analyzer_version: $analyzerVersion
          }]->(b)
          `,
          {
            repoId: opts.repoId,
            sha: opts.sha,
            from: edge.from,
            to: edge.to,
            analyzerVersion: opts.analyzerVersion,
          },
        );
      }
    });
  } finally {
    await session.close();
  }
}

export async function queryGraphSlice(opts: {
  repoId: string;
  sha: string;
  view: 'package' | 'file';
  maxNodes: number;
}) {
  const session = neo4jDriver().session();
  try {
    const kindFilter = opts.view === 'package' ? 'package' : 'file';
    const result = await session.run(
      `
      MATCH (n {repo_id: $repoId, sha: $sha, kind: $kind})
      WITH n LIMIT $limit
      OPTIONAL MATCH (n)-[r]->(m {repo_id: $repoId, sha: $sha, kind: $kind})
      RETURN n, r, m
      `,
      {
        repoId: opts.repoId,
        sha: opts.sha,
        kind: kindFilter,
        limit: neo4j.int(opts.maxNodes),
      },
    );

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
      if (m && r) {
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
      view: opts.view,
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
