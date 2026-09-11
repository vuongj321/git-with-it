'use client';

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  api,
  type MetricSeriesResponse,
  type MetricsSummary,
  type Org,
  type Repo,
  type SampleCommit,
} from '@/lib/api';
import { useRepoUrlState } from '@/lib/url-state';

export default function MetricsPage() {
  const params = useParams<{ org: string; repo: string }>();
  const { sha, metric, setState } = useRepoUrlState();

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

  const commitsQuery = useQuery({
    queryKey: ['commits', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () =>
      api<SampleCommit[]>(
        `/v1/repos/${params.repo}/commits?orgId=${orgQuery.data!.id}&sampled=true`,
      ),
  });

  const summaryQuery = useQuery({
    queryKey: ['metrics-summary', params.repo, effectiveSha],
    enabled: Boolean(orgQuery.data?.id && effectiveSha),
    queryFn: () =>
      api<MetricsSummary>(
        `/v1/repos/${params.repo}/metrics/summary?orgId=${orgQuery.data!.id}&sha=${effectiveSha}`,
      ),
  });

  const seriesQuery = useQuery({
    queryKey: ['metrics-series', params.repo, metric],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () =>
      api<MetricSeriesResponse>(
        `/v1/repos/${params.repo}/metrics?orgId=${orgQuery.data!.id}&names=${metric},cycle_count,fan_in,fan_out,complexity_proxy`,
      ),
  });

  const topFanIn = useQuery({
    queryKey: ['metrics-top-fanin', params.repo, effectiveSha],
    enabled: Boolean(orgQuery.data?.id && effectiveSha),
    queryFn: () =>
      api<{ values: Array<{ entityId: string; value: number }> }>(
        `/v1/repos/${params.repo}/metrics/top?orgId=${orgQuery.data!.id}&sha=${effectiveSha}&metric=fan_in&view=package`,
      ),
  });

  const topComplexity = useQuery({
    queryKey: ['metrics-top-cx', params.repo, effectiveSha],
    enabled: Boolean(orgQuery.data?.id && effectiveSha),
    queryFn: () =>
      api<{ values: Array<{ entityId: string; value: number }> }>(
        `/v1/repos/${params.repo}/metrics/top?orgId=${orgQuery.data!.id}&sha=${effectiveSha}&metric=complexity_proxy&view=file`,
      ),
  });

  const cyclesQuery = useQuery({
    queryKey: ['metrics-cycles', params.repo, effectiveSha],
    enabled: Boolean(orgQuery.data?.id && effectiveSha),
    queryFn: () =>
      api<{ members: Array<{ entityId: string; value: number }> }>(
        `/v1/repos/${params.repo}/metrics/cycles?orgId=${orgQuery.data!.id}&sha=${effectiveSha}`,
      ),
  });

  const chartOption = useMemo(() => {
    const cycleSeries = seriesQuery.data?.series.find(
      (s) => s.metric === 'cycle_count',
    );
    const points = cycleSeries?.points ?? [];
    return {
      backgroundColor: 'transparent',
      textStyle: { color: '#c4c4cc' },
      grid: { left: 40, right: 20, top: 30, bottom: 40 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: points.map((p) => p.commitSha.slice(0, 7)),
        axisLabel: { color: '#9a9aa3' },
      },
      yAxis: {
        type: 'value',
        name: 'cycle_count',
        axisLabel: { color: '#9a9aa3' },
        splitLine: { lineStyle: { color: 'rgba(242,242,244,0.08)' } },
      },
      series: [
        {
          name: 'cycle_count',
          type: 'line',
          smooth: true,
          data: points.map((p) => p.value),
          lineStyle: { color: '#8a70ff' },
          itemStyle: { color: '#00c2ff' },
        },
      ],
    };
  }, [seriesQuery.data]);

  const summary = summaryQuery.data;
  const samples = commitsQuery.data ?? [];

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="section-title">Metrics</h2>
        <p className="muted">
          Complexity values are a decision-node proxy — not full cyclomatic complexity.
        </p>
        <div className="row" style={{ marginTop: '1rem' }}>
          <label className="chrome-field">
            <span className="label">SHA</span>
            <select
              className="field"
              value={effectiveSha}
              onChange={(e) => setState({ sha: e.target.value })}
            >
              {samples.map((c) => (
                <option key={c.sha} value={c.sha}>
                  {c.sha.slice(0, 12)} · {c.message?.slice(0, 40) ?? ''}
                </option>
              ))}
            </select>
          </label>
          <label className="chrome-field">
            <span className="label">Series focus</span>
            <select
              className="field"
              value={metric}
              onChange={(e) => setState({ metric: e.target.value })}
            >
              <option value="fan_in">fan_in</option>
              <option value="fan_out">fan_out</option>
              <option value="complexity_proxy">complexity_proxy</option>
              <option value="loc">loc</option>
            </select>
          </label>
        </div>
      </section>

      {summary ? (
        <section className="panel">
          <div className="metric-cards">
            <div className="metric-card">
              <div className="label">Cycles</div>
              <div className="metric-value">{summary.cycleCount}</div>
            </div>
            <div className="metric-card">
              <div className="label">Avg fan-in</div>
              <div className="metric-value">{summary.avgFanIn.toFixed(2)}</div>
            </div>
            <div className="metric-card">
              <div className="label">Avg complexity proxy</div>
              <div className="metric-value">
                {summary.avgComplexity.toFixed(1)}
              </div>
            </div>
            <div className="metric-card">
              <div className="label">Total LOC</div>
              <div className="metric-value">{Math.round(summary.totalLoc)}</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h3 className="section-title">Cycle count over samples</h3>
        <ReactECharts option={chartOption} style={{ height: 280 }} />
      </section>

      <section className="panel">
        <h3 className="section-title">Top fan-in (packages)</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {(topFanIn.data?.values ?? []).map((r) => (
              <tr key={r.entityId}>
                <td className="mono">{r.entityId.slice(0, 8)}…</td>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3 className="section-title">Top complexity proxy (files)</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {(topComplexity.data?.values ?? []).map((r) => (
              <tr key={r.entityId}>
                <td className="mono">{r.entityId.slice(0, 8)}…</td>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3 className="section-title">Packages in cycles</h3>
        {(cyclesQuery.data?.members ?? []).length === 0 ? (
          <p className="muted">No cycle members at this SHA.</p>
        ) : (
          <ul className="event-list">
            {(cyclesQuery.data?.members ?? []).map((m) => (
              <li key={m.entityId} className="mono">
                {m.entityId}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
