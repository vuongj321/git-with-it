import type { GraphDiff } from './graph-diff';

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
};

export const DEFAULT_EVENT_RULES: EventRuleConfig = {
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

/**
 * Deterministic evolution event rules (no LLM). See ADR 0010.
 */
export function eventsFromDiff(
  diff: GraphDiff,
  opts: Partial<EventRuleConfig> = {},
): EvolutionEventDraft[] {
  const rules = { ...DEFAULT_EVENT_RULES, ...opts };
  const events: EvolutionEventDraft[] = [];

  for (const e of diff.edgesAdded) {
    if (e.rel !== 'DEPENDS_ON' && e.rel !== 'IMPORTS') continue;
    events.push({
      type: 'dependency_added',
      severity: 'info',
      title: `Dependency added: ${e.from} → ${e.to}`,
      payload: { edge: e },
      entityIds: [e.from, e.to],
    });
  }
  for (const e of diff.edgesRemoved) {
    if (e.rel !== 'DEPENDS_ON' && e.rel !== 'IMPORTS') continue;
    events.push({
      type: 'dependency_removed',
      severity: 'info',
      title: `Dependency removed: ${e.from} → ${e.to}`,
      payload: { edge: e },
      entityIds: [e.from, e.to],
    });
  }

  for (const scc of diff.sccsAdded) {
    events.push({
      type: 'cycle_introduced',
      severity: severityForCycle(),
      title: `Cycle introduced (${scc.length} nodes)`,
      payload: { scc },
      entityIds: scc,
    });
  }
  for (const scc of diff.sccsRemoved) {
    events.push({
      type: 'cycle_resolved',
      severity: 'medium',
      title: `Cycle resolved (${scc.length} nodes)`,
      payload: { scc },
      entityIds: scc,
    });
  }

  for (const n of diff.nodesAdded) {
    if (n.kind !== 'package') continue;
    events.push({
      type: 'module_added',
      severity: 'low',
      title: `Module added: ${n.fqn}`,
      payload: { node: n },
      entityIds: [n.id],
    });
  }
  for (const n of diff.nodesRemoved) {
    if (n.kind !== 'package') continue;
    events.push({
      type: 'module_removed',
      severity: 'low',
      title: `Module removed: ${n.fqn}`,
      payload: { node: n },
      entityIds: [n.id],
    });
  }

  for (const r of diff.nodesRenamed) {
    events.push({
      type: 'rename_detected',
      severity: 'info',
      title: `Rename: ${r.fromFqn ?? r.fromId} → ${r.toFqn ?? r.toId}`,
      payload: { rename: r },
      entityIds: [r.fromId, r.toId],
    });
  }

  for (const d of [...diff.fanInDeltas, ...diff.fanOutDeltas]) {
    if (Math.abs(d.delta) < rules.couplingDeltaThreshold) continue;
    events.push({
      type: 'coupling_spike',
      severity: Math.abs(d.delta) >= rules.couplingDeltaThreshold * 2 ? 'high' : 'medium',
      title: `Coupling spike on ${d.id} (Δ${d.delta > 0 ? '+' : ''}${d.delta})`,
      payload: { degree: d },
      entityIds: [d.id],
    });
  }

  return events;
}
