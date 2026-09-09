'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  api,
  type MetricsDeltaResponse,
  type Org,
  type SampleCommit,
} from '@/lib/api';
import { useRepoUrlState } from '@/lib/url-state';
import { ArchitectureGraph } from '@/components/ArchitectureGraph';

export default function ComparePage() {
  const params = useParams<{ org: string; repo: string }>();
  const { from, to, setState } = useRepoUrlState();

  const orgQuery = useQuery({
    queryKey: ['org', params.org],
    queryFn: () => api<Org>(`/v1/orgs/by-slug/${params.org}`),
  });

  const commitsQuery = useQuery({
    queryKey: ['commits', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () =>
      api<SampleCommit[]>(
        `/v1/repos/${params.repo}/commits?orgId=${orgQuery.data!.id}&sampled=true`,
      ),
  });

  useEffect(() => {
    const list = commitsQuery.data;
    if (!list?.length) return;
    if (!from) setState({ from: list[0]!.sha });
    if (!to) setState({ to: list[list.length - 1]!.sha });
  }, [commitsQuery.data, from, setState, to]);

  const deltaQuery = useQuery({
    queryKey: ['metrics-delta', params.repo, from, to],
    enabled: Boolean(orgQuery.data?.id && from && to),
    queryFn: () =>
      api<MetricsDeltaResponse>(
        `/v1/repos/${params.repo}/metrics/delta?orgId=${orgQuery.data!.id}&from=${from}&to=${to}`,
      ),
  });

  const samples = commitsQuery.data ?? [];

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="section-title">Compare</h2>
        <p className="muted">
          Pick two sampled SHAs to inspect graph diff and metric movers.
        </p>
        <div className="row" style={{ marginTop: '1rem' }}>
          <label className="chrome-field">
            <span className="label">From</span>
            <select
              className="field"
              value={from}
              onChange={(e) => setState({ from: e.target.value })}
            >
              {samples.map((c) => (
                <option key={c.sha} value={c.sha}>
                  {c.sha.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
          <label className="chrome-field">
            <span className="label">To</span>
            <select
              className="field"
              value={to}
              onChange={(e) => setState({ to: e.target.value })}
            >
              {samples.map((c) => (
                <option key={c.sha} value={c.sha}>
                  {c.sha.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h3 className="section-title">Metric deltas</h3>
        {deltaQuery.isLoading ? <p className="muted">Loading…</p> : null}
        <table className="data-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Entity</th>
              <th>From</th>
              <th>To</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {(deltaQuery.data?.movers ?? []).slice(0, 30).map((m) => (
              <tr key={`${m.entityId}-${m.metric}`}>
                <td className="mono">{m.metric}</td>
                <td className="mono">{m.entityId.slice(0, 8)}…</td>
                <td>{m.fromValue}</td>
                <td>{m.toValue}</td>
                <td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel graph-embed">
        <h3 className="section-title">Diff graph</h3>
        <p className="muted">
          Green = added · Red = removed · Amber = persisted in range
        </p>
        <ArchitectureGraph />
      </section>
    </div>
  );
}
