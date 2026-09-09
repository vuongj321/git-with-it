export type GraphNode = {
  id: string;
  kind: string;
  fqn: string;
  name: string;
  path?: string | null;
  language?: string | null;
  package?: string | null;
};

export type GraphEdge = {
  from: string;
  to: string;
  rel: string;
};

export type GraphSnapshot = {
  sha: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  repo_id?: string;
  repoId?: string;
  analyzer_version?: string;
  analyzerVersion?: string;
};

export type GraphDiff = {
  fromSha: string;
  toSha: string;
  nodesAdded: GraphNode[];
  nodesRemoved: GraphNode[];
  nodesRenamed: Array<{
    fromId: string;
    toId: string;
    fromFqn?: string;
    toFqn?: string;
    confidence: number;
  }>;
  edgesAdded: GraphEdge[];
  edgesRemoved: GraphEdge[];
  sccsAdded: string[][];
  sccsRemoved: string[][];
  fanInDeltas: Array<{ id: string; from: number; to: number; delta: number }>;
  fanOutDeltas: Array<{ id: string; from: number; to: number; delta: number }>;
  highlightIds: string[];
};

export type DiffOptions = {
  /** Map old node id → new node id for known renames. */
  renameMap?: Map<string, string>;
  couplingDeltaThreshold?: number;
};

export function edgeKey(e: Pick<GraphEdge, 'from' | 'to' | 'rel'>): string {
  return `${e.from}\0${e.rel}\0${e.to}`;
}

/** Tarjan SCCs; returns components with length >= 2 (cycles). */
export function findSccs(edges: GraphEdge[], nodeIds: string[]): string[][] {
  const nodes = [...new Set([...nodeIds, ...edges.flatMap((e) => [e.from, e.to])])];
  const adj = new Map<string, string[]>();
  for (const id of nodes) adj.set(id, []);
  for (const e of edges) {
    if (e.rel !== 'DEPENDS_ON' && e.rel !== 'IMPORTS') continue;
    adj.get(e.from)?.push(e.to);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongconnect(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length >= 2) sccs.push(comp.sort());
    }
  }

  for (const v of nodes) {
    if (!indices.has(v)) strongconnect(v);
  }
  return sccs;
}

function degreeMaps(edges: GraphEdge[], rel = 'DEPENDS_ON') {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const e of edges) {
    if (e.rel !== rel) continue;
    fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
    fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
  }
  return { fanIn, fanOut };
}

function normalizeSnapshot(s: GraphSnapshot): {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
} {
  const nodes = new Map<string, GraphNode>();
  for (const n of s.nodes) nodes.set(n.id, n);
  const edges = new Map<string, GraphEdge>();
  for (const e of s.edges) edges.set(edgeKey(e), e);
  return { nodes, edges };
}

function sccKey(comp: string[]): string {
  return comp.slice().sort().join('\0');
}

/**
 * Align entities by stable id (+ rename chains), then compute node/edge/SCC diffs.
 */
export function diffGraphs(
  from: GraphSnapshot,
  to: GraphSnapshot,
  opts: DiffOptions = {},
): GraphDiff {
  const renameMap = opts.renameMap ?? new Map<string, string>();
  const threshold = opts.couplingDeltaThreshold ?? 5;

  const a = normalizeSnapshot(from);
  const b = normalizeSnapshot(to);

  // Apply renames: treat from-id as to-id for set alignment
  const reverseRename = new Map<string, string>();
  for (const [oldId, newId] of renameMap) reverseRename.set(newId, oldId);

  const nodesAdded: GraphNode[] = [];
  const nodesRemoved: GraphNode[] = [];
  const nodesRenamed: GraphDiff['nodesRenamed'] = [];

  for (const [id, node] of b.nodes) {
    const oldId = reverseRename.get(id);
    if (oldId && a.nodes.has(oldId)) {
      nodesRenamed.push({
        fromId: oldId,
        toId: id,
        fromFqn: a.nodes.get(oldId)?.fqn,
        toFqn: node.fqn,
        confidence: 1,
      });
      continue;
    }
    if (!a.nodes.has(id) && !oldId) {
      nodesAdded.push(node);
    }
  }
  for (const [id, node] of a.nodes) {
    if (renameMap.has(id)) continue;
    if (!b.nodes.has(id)) nodesRemoved.push(node);
  }

  const edgesAdded: GraphEdge[] = [];
  const edgesRemoved: GraphEdge[] = [];

  const mapEdgeId = (id: string) => renameMap.get(id) ?? id;
  const aEdgesMapped = new Map<string, GraphEdge>();
  for (const e of a.edges.values()) {
    const mapped = {
      from: mapEdgeId(e.from),
      to: mapEdgeId(e.to),
      rel: e.rel,
    };
    aEdgesMapped.set(edgeKey(mapped), mapped);
  }

  for (const [k, e] of b.edges) {
    if (!aEdgesMapped.has(k)) edgesAdded.push(e);
  }
  for (const [k, e] of aEdgesMapped) {
    if (!b.edges.has(k)) edgesRemoved.push(e);
  }

  const fromSccs = findSccs([...a.edges.values()], [...a.nodes.keys()]);
  const toSccs = findSccs([...b.edges.values()], [...b.nodes.keys()]);
  const fromKeys = new Set(fromSccs.map(sccKey));
  const toKeys = new Set(toSccs.map(sccKey));
  const sccsAdded = toSccs.filter((c) => !fromKeys.has(sccKey(c)));
  const sccsRemoved = fromSccs.filter((c) => !toKeys.has(sccKey(c)));

  const degA = degreeMaps([...a.edges.values()]);
  const degB = degreeMaps([...b.edges.values()]);
  const fanInDeltas: GraphDiff['fanInDeltas'] = [];
  const fanOutDeltas: GraphDiff['fanOutDeltas'] = [];
  const allIds = new Set([...degA.fanIn.keys(), ...degB.fanIn.keys(), ...degA.fanOut.keys(), ...degB.fanOut.keys()]);
  for (const id of allIds) {
    const fiFrom = degA.fanIn.get(id) ?? 0;
    const fiTo = degB.fanIn.get(mapEdgeId(id)) ?? degB.fanIn.get(id) ?? 0;
    const foFrom = degA.fanOut.get(id) ?? 0;
    const foTo = degB.fanOut.get(mapEdgeId(id)) ?? degB.fanOut.get(id) ?? 0;
    if (Math.abs(fiTo - fiFrom) >= threshold) {
      fanInDeltas.push({ id, from: fiFrom, to: fiTo, delta: fiTo - fiFrom });
    }
    if (Math.abs(foTo - foFrom) >= threshold) {
      fanOutDeltas.push({ id, from: foFrom, to: foTo, delta: foTo - foFrom });
    }
  }

  const highlightIds = [
    ...nodesAdded.map((n) => n.id),
    ...nodesRemoved.map((n) => n.id),
    ...nodesRenamed.flatMap((r) => [r.fromId, r.toId]),
    ...edgesAdded.flatMap((e) => [e.from, e.to]),
    ...edgesRemoved.flatMap((e) => [e.from, e.to]),
    ...sccsAdded.flat(),
    ...sccsRemoved.flat(),
    ...fanInDeltas.map((d) => d.id),
    ...fanOutDeltas.map((d) => d.id),
  ];

  return {
    fromSha: from.sha,
    toSha: to.sha,
    nodesAdded,
    nodesRemoved,
    nodesRenamed,
    edgesAdded,
    edgesRemoved,
    sccsAdded,
    sccsRemoved,
    fanInDeltas,
    fanOutDeltas,
    highlightIds: [...new Set(highlightIds)],
  };
}
