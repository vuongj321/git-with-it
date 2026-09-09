import type { GraphDiff, GraphNode } from './graph-diff';
import { entityId, graphRefToEntityId } from './entity-id';

export type EvolutionEventType =
  | 'dependency_added'
  | 'dependency_removed'
  | 'cycle_introduced'
  | 'cycle_resolved'
  | 'module_added'
  | 'module_removed'
  | 'rename_detected'
  | 'coupling_spike';

export type EvolutionSeverity = 'info' | 'low' | 'medium' | 'high';

export type EventRuleConfig = {
  couplingDeltaThreshold: number;
  /** Required to emit stable UUIDv5 entity ids (same as metrics / Postgres). */
  repoId: string;
};

export const DEFAULT_EVENT_RULES: Omit<EventRuleConfig, 'repoId'> = {
  couplingDeltaThreshold: 5,
};

export type EvolutionEventDraft = {
  type: EvolutionEventType;
  severity: EvolutionSeverity;
  title: string;
  payload: Record<string, unknown>;
  entityIds: string[];
};

function severityForCycle(): EvolutionSeverity {
  return 'high';
}

function nodeMapFromDiff(diff: GraphDiff): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  for (const n of [...diff.nodesAdded, ...diff.nodesRemoved]) {
    map.set(n.id, n);
  }
  return map;
}

function toEntityIds(
  repoId: string,
  refs: Array<string | GraphNode>,
  nodes: Map<string, GraphNode>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    let id: string;
    if (typeof ref !== 'string') {
      id = graphRefToEntityId(repoId, ref);
    } else {
      const node = nodes.get(ref);
      id = node ? graphRefToEntityId(repoId, node) : graphRefToEntityId(repoId, ref);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Deterministic evolution event rules (no LLM). See ADR 0010.
 * `entityIds` are always product UUIDv5 ids (never raw graph node ids).
 */
export function eventsFromDiff(
  diff: GraphDiff,
  opts: Partial<Omit<EventRuleConfig, 'repoId'>> & { repoId: string },
): EvolutionEventDraft[] {
  const rules = { ...DEFAULT_EVENT_RULES, ...opts };
  const { repoId } = opts;
  const nodes = nodeMapFromDiff(diff);
  const events: EvolutionEventDraft[] = [];

  for (const e of diff.edgesAdded) {
    if (e.rel !== 'DEPENDS_ON' && e.rel !== 'IMPORTS') continue;
    events.push({
      type: 'dependency_added',
      severity: 'info',
      title: `Dependency added: ${e.from} → ${e.to}`,
      payload: { edge: e },
      entityIds: toEntityIds(repoId, [e.from, e.to], nodes),
    });
  }
  for (const e of diff.edgesRemoved) {
    if (e.rel !== 'DEPENDS_ON' && e.rel !== 'IMPORTS') continue;
    events.push({
      type: 'dependency_removed',
      severity: 'info',
      title: `Dependency removed: ${e.from} → ${e.to}`,
      payload: { edge: e },
      entityIds: toEntityIds(repoId, [e.from, e.to], nodes),
    });
  }

  for (const scc of diff.sccsAdded) {
    events.push({
      type: 'cycle_introduced',
      severity: severityForCycle(),
      title: `Cycle introduced (${scc.length} nodes)`,
      payload: { scc },
      entityIds: toEntityIds(repoId, scc, nodes),
    });
  }
  for (const scc of diff.sccsRemoved) {
    events.push({
      type: 'cycle_resolved',
      severity: 'medium',
      title: `Cycle resolved (${scc.length} nodes)`,
      payload: { scc },
      entityIds: toEntityIds(repoId, scc, nodes),
    });
  }

  for (const n of diff.nodesAdded) {
    if (n.kind !== 'package') continue;
    events.push({
      type: 'module_added',
      severity: 'low',
      title: `Module added: ${n.fqn}`,
      payload: { node: n },
      entityIds: toEntityIds(repoId, [n], nodes),
    });
  }
  for (const n of diff.nodesRemoved) {
    if (n.kind !== 'package') continue;
    events.push({
      type: 'module_removed',
      severity: 'low',
      title: `Module removed: ${n.fqn}`,
      payload: { node: n },
      entityIds: toEntityIds(repoId, [n], nodes),
    });
  }

  for (const r of diff.nodesRenamed) {
    const fromId = r.fromFqn
      ? entityId(repoId, 'file', r.fromFqn)
      : graphRefToEntityId(repoId, nodes.get(r.fromId) ?? r.fromId);
    const toId = r.toFqn
      ? entityId(repoId, 'file', r.toFqn)
      : graphRefToEntityId(repoId, nodes.get(r.toId) ?? r.toId);
    events.push({
      type: 'rename_detected',
      severity: 'info',
      title: `Rename: ${r.fromFqn ?? r.fromId} → ${r.toFqn ?? r.toId}`,
      payload: { rename: r },
      entityIds: [...new Set([fromId, toId])],
    });
  }

  for (const d of [...diff.fanInDeltas, ...diff.fanOutDeltas]) {
    if (Math.abs(d.delta) < rules.couplingDeltaThreshold) continue;
    events.push({
      type: 'coupling_spike',
      severity: Math.abs(d.delta) >= rules.couplingDeltaThreshold * 2 ? 'high' : 'medium',
      title: `Coupling spike on ${d.id} (Δ${d.delta > 0 ? '+' : ''}${d.delta})`,
      payload: { degree: d },
      entityIds: toEntityIds(repoId, [d.id], nodes),
    });
  }

  return events;
}
