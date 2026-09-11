'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  api,
  type GraphDiffPayload,
  type GraphSlice,
  type HeatmapResponse,
  type Insight,
  type Org,
  type Repo,
} from '@/lib/api';
import { useRepoUrlState } from '@/lib/url-state';

/** Colorblind-safe sequential (blue → amber), not purple chrome. */
function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(40 + x * 180);
  const g = Math.round(90 + x * 90);
  const b = Math.round(160 - x * 120);
  return `rgb(${r},${g},${b})`;
}

export function ArchitectureGraph() {
  const params = useParams<{ org: string; repo: string }>();
  const { sha, from, to, view, metric, focus, setState } = useRepoUrlState();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [selected, setSelected] = useState<{
    id: string;
    label: string;
    fqn: string;
    kind?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orgQuery = useQuery({
    queryKey: ['org', params.org],
    queryFn: () => api<Org>(`/v1/orgs/by-slug/${params.org}`),
  });

  const repoQuery = useQuery({
    queryKey: ['repo', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () =>
      api<Repo>(`/v1/repos/${params.repo}?orgId=${orgQuery.data!.id}`),
  });

  const effectiveSha = sha || repoQuery.data?.lastSyncedSha || '';
  const compareMode = Boolean(from && to);

  const graphQuery = useQuery({
    queryKey: ['graph', params.repo, effectiveSha, view],
    enabled: Boolean(orgQuery.data?.id && effectiveSha && !compareMode),
    queryFn: () =>
      api<GraphSlice>(
        `/v1/repos/${params.repo}/graph?orgId=${orgQuery.data!.id}&sha=${effectiveSha}&view=${view}&limit=500`,
      ),
  });

  const heatmapQuery = useQuery({
    queryKey: ['heatmap', params.repo, effectiveSha, metric, view],
    enabled: Boolean(orgQuery.data?.id && effectiveSha && !compareMode),
    queryFn: () =>
      api<HeatmapResponse>(
        `/v1/repos/${params.repo}/metrics/heatmap?orgId=${orgQuery.data!.id}&sha=${effectiveSha}&metric=${metric}&view=${view}`,
      ),
  });

  const diffQuery = useQuery({
    queryKey: ['graph-diff', params.repo, from, to],
    enabled: Boolean(orgQuery.data?.id && compareMode),
    queryFn: () =>
      api<GraphDiffPayload>(
        `/v1/repos/${params.repo}/graph/diff?orgId=${orgQuery.data!.id}&from=${from}&to=${to}`,
      ),
  });

  const selectedInsightsQuery = useQuery({
    queryKey: ['entity-insights', params.repo, selected?.id, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && selected?.id),
    queryFn: () => {
      const q = new URLSearchParams({
        orgId: orgQuery.data!.id,
        entity: selected!.id,
        limit: '5',
      });
      // Query param avoids path breaks on `pkg:scope/name` and lets the API map graph refs → UUIDv5.
      return api<Insight[]>(`/v1/repos/${params.repo}/insights?${q.toString()}`);
    },
  });

  const heatMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of heatmapQuery.data?.values ?? []) {
      m.set(v.entityId, v.value);
      if (v.graphId) m.set(v.graphId, v.value);
      if (v.fqn) m.set(v.fqn, v.value);
    }
    return m;
  }, [heatmapQuery.data]);

  const heatMax = useMemo(() => {
    let max = 1;
    for (const v of heatMap.values()) max = Math.max(max, v);
    return max;
  }, [heatMap]);

  useEffect(() => {
    if (!containerRef.current) return;
    setError(null);

    const graph = new Graph();
    try {
      if (compareMode && diffQuery.data) {
        const diff = diffQuery.data;
        const addedN = new Set((diff.nodesAdded ?? []).map((n) => n.id));
        const removedN = new Set((diff.nodesRemoved ?? []).map((n) => n.id));
        const addedE = new Set(
          (diff.edgesAdded ?? []).map((e) => `${e.from}->${e.to}`),
        );
        const removedE = new Set(
          (diff.edgesRemoved ?? []).map((e) => `${e.from}->${e.to}`),
        );
        const nodes = [
          ...(diff.nodesAdded ?? []),
          ...(diff.nodesRemoved ?? []),
        ];
        // Persist nodes that appear in edges
        for (const e of [...(diff.edgesAdded ?? []), ...(diff.edgesRemoved ?? [])]) {
          if (!nodes.find((n) => n.id === e.from)) {
            nodes.push({ id: e.from, kind: 'package', fqn: e.from, name: e.from });
          }
          if (!nodes.find((n) => n.id === e.to)) {
            nodes.push({ id: e.to, kind: 'package', fqn: e.to, name: e.to });
          }
        }
        for (const n of nodes) {
          if (graph.hasNode(n.id)) continue;
          let color = '#9a9aa3';
          if (addedN.has(n.id)) color = '#8a70ff';
          else if (removedN.has(n.id)) color = '#e85d4c';
          else color = '#d4a017';
          graph.addNode(n.id, {
            label: n.name || n.fqn,
            fqn: n.fqn,
            size: 6,
            color,
            x: Math.random(),
            y: Math.random(),
          });
        }
        for (const e of [...(diff.edgesAdded ?? []), ...(diff.edgesRemoved ?? [])]) {
          const key = `${e.from}->${e.to}`;
          if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue;
          if (graph.hasEdge(e.from, e.to)) continue;
          let color = '#d4a017';
          if (addedE.has(key)) color = '#8a70ff';
          if (removedE.has(key)) color = '#e85d4c';
          graph.addEdge(e.from, e.to, { size: 1.5, color });
        }
      } else if (graphQuery.data) {
        const slice = graphQuery.data;
        for (const n of slice.nodes) {
          const heat = heatMap.get(n.id);
          const color =
            heat != null ? heatColor(heat / heatMax) : '#b5a6ff';
          graph.addNode(n.id, {
            label: n.name || n.fqn,
            fqn: n.fqn,
            size: focus && n.id === focus ? 10 : 5,
            color,
            x: Math.random(),
            y: Math.random(),
          });
        }
        for (const e of slice.edges) {
          if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue;
          if (graph.hasEdge(e.from, e.to)) continue;
          graph.addEdge(e.from, e.to, { size: 1, color: 'rgba(242,242,244,0.22)' });
        }
      } else {
        return;
      }

      if (graph.order === 0) {
        setError('No nodes in this graph slice.');
        return;
      }

      if (graph.order < 2000) {
        forceAtlas2.assign(graph, {
          iterations: 80,
          settings: { gravity: 1, scalingRatio: 10, barnesHutOptimize: true },
        });
      }

      sigmaRef.current?.kill();
      const sigma = new Sigma(graph, containerRef.current, {
        allowInvalidContainer: true,
        labelColor: { color: '#f2f2f4' },
        defaultEdgeColor: 'rgba(242,242,244,0.22)',
      });
      sigma.on('clickNode', ({ node }) => {
        const attrs = graph.getNodeAttributes(node);
        setSelected({
          id: node,
          label: String(attrs.label ?? node),
          fqn: String(attrs.fqn ?? node),
          kind: attrs.kind != null ? String(attrs.kind) : undefined,
        });
        setState({ focus: node });
      });
      sigmaRef.current = sigma;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      sigmaRef.current?.kill();
      sigmaRef.current = null;
    };
  }, [
    compareMode,
    diffQuery.data,
    focus,
    graphQuery.data,
    heatMap,
    heatMax,
    setState,
  ]);

  const loading =
    (!compareMode && graphQuery.isLoading) ||
    (compareMode && diffQuery.isLoading);
  const truncated = graphQuery.data?.truncated;

  return (
    <div className="graph-shell">
      <div className="graph-chrome">
        <label className="chrome-field">
          <span className="label">SHA</span>
          <input
            className="field"
            value={effectiveSha}
            onChange={(e) => setState({ sha: e.target.value, from: '', to: '' })}
            placeholder="commit sha"
          />
        </label>
        <label className="chrome-field">
          <span className="label">View</span>
          <select
            className="field"
            value={view}
            onChange={(e) =>
              setState({ view: e.target.value as 'package' | 'file' })
            }
          >
            <option value="package">Package</option>
            <option value="file">File</option>
          </select>
        </label>
        <label className="chrome-field">
          <span className="label">Heatmap</span>
          <select
            className="field"
            value={metric}
            onChange={(e) => setState({ metric: e.target.value })}
          >
            <option value="fan_in">Fan-in</option>
            <option value="fan_out">Fan-out</option>
            <option value="complexity_proxy">Complexity proxy</option>
            <option value="maintainability_proxy">Maintainability proxy</option>
            <option value="loc">LOC</option>
            <option value="cycle_member">Cycle member</option>
          </select>
        </label>
        {compareMode ? (
          <span className="muted mono">
            Diff {from.slice(0, 7)}→{to.slice(0, 7)}
          </span>
        ) : null}
      </div>
      <div className="graph-stage">
        <div ref={containerRef} className="graph-canvas" />
        {loading ? <div className="graph-overlay muted">Loading graph…</div> : null}
        {error ? <div className="graph-overlay error">{error}</div> : null}
        {truncated ? (
          <div className="graph-banner muted">
            Graph truncated at server cap — expand from a focus node for ego network.
          </div>
        ) : null}
        {selected ? (
          <aside className="graph-panel">
            <div className="label">Selected</div>
            <div className="mono">{selected.label}</div>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              {selected.fqn}
            </p>
            <p className="muted mono" style={{ fontSize: '0.8rem' }}>
              {selected.id}
            </p>
            <div className="label" style={{ marginTop: '1rem' }}>
              Related insights
            </div>
            {selectedInsightsQuery.isLoading ? (
              <p className="muted">Loading insights…</p>
            ) : (selectedInsightsQuery.data ?? []).length === 0 ? (
              <p className="muted">No insights mention this entity yet.</p>
            ) : (
              <ul className="event-list" style={{ marginTop: '0.5rem' }}>
                {(selectedInsightsQuery.data ?? []).map((insight) => (
                  <li key={insight.id}>
                    <span className={`sev sev-${insight.severity}`}>{insight.severity}</span>{' '}
                    {insight.headline}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: '0.75rem' }}
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
