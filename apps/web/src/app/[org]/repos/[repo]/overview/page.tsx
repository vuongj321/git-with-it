'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  api,
  type EvolutionEvent,
  type MetricsSummary,
  type Org,
  type Repo,
  type Run,
  type SampleCommit,
} from '@/lib/api';

export default function OverviewPage() {
  const params = useParams<{ org: string; repo: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const runId = search.get('runId');
  const base = `/${params.org}/repos/${params.repo}`;

  const orgQuery = useQuery({
    queryKey: ['org', params.org],
    queryFn: () => api<Org>(`/v1/orgs/by-slug/${params.org}`),
  });

  const repoQuery = useQuery({
    queryKey: ['repo', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () =>
      api<Repo>(`/v1/repos/${params.repo}?orgId=${orgQuery.data!.id}`),
    refetchInterval: 3_000,
  });

  const runQuery = useQuery({
    queryKey: ['run', params.repo, runId, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && runId),
    queryFn: () =>
      api<Run>(
        `/v1/repos/${params.repo}/runs/${runId}?orgId=${orgQuery.data!.id}`,
      ),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'evolution_ready' || status === 'failed') return false;
      return 2_000;
    },
  });

  const tipSha = repoQuery.data?.lastSyncedSha;

  const summaryQuery = useQuery({
    queryKey: ['metrics-summary', params.repo, tipSha, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && tipSha),
    queryFn: () =>
      api<MetricsSummary>(
        `/v1/repos/${params.repo}/metrics/summary?orgId=${orgQuery.data!.id}&sha=${tipSha}`,
      ),
  });

  // Prefetch tip graph for Graph route
  useQuery({
    queryKey: ['graph', params.repo, tipSha, 'package'],
    enabled: Boolean(orgQuery.data?.id && tipSha),
    queryFn: () =>
      api(
        `/v1/repos/${params.repo}/graph?orgId=${orgQuery.data!.id}&sha=${tipSha}&view=package`,
      ),
    staleTime: 60_000,
  });

  const eventsQuery = useQuery({
    queryKey: ['timeline-high', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && tipSha),
    queryFn: () =>
      api<EvolutionEvent[]>(
        `/v1/repos/${params.repo}/timeline?orgId=${orgQuery.data!.id}&limit=20`,
      ),
  });

  const commitsQuery = useQuery({
    queryKey: ['commits', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && tipSha),
    queryFn: () =>
      api<SampleCommit[]>(
        `/v1/repos/${params.repo}/commits?orgId=${orgQuery.data!.id}&sampled=true`,
      ),
  });

  async function reanalyze() {
    if (!orgQuery.data) return;
    const analyzed = await api<{ run: { id: string } }>(
      `/v1/repos/${params.repo}/analyze?orgId=${orgQuery.data.id}`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    router.replace(`${base}/overview?runId=${analyzed.run.id}`);
  }

  const repo = repoQuery.data;
  const run = runQuery.data;
  const summary = summaryQuery.data;
  const highEvents = (eventsQuery.data ?? []).filter(
    (e) => e.severity === 'high' || e.severity === 'medium',
  );
  const samples = commitsQuery.data ?? [];

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="section-title">Run status</h2>
        <p className="muted">
          Tip {tipSha ? <span className="mono">{tipSha.slice(0, 12)}</span> : '—'} ·{' '}
          {samples.length} sampled commits
        </p>
        {run ? (
          <p className="mono">
            {run.status}
            {run.commitsTotal
              ? ` · ${run.commitsDone ?? 0}/${run.commitsTotal}`
              : ''}
          </p>
        ) : (
          <p className="muted">No active run selected.</p>
        )}
        <div className="row" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn" onClick={() => void reanalyze()}>
            Re-analyze
          </button>
          <Link className="btn btn-ghost" href={`${base}/graph${tipSha ? `?sha=${tipSha}` : ''}`}>
            Open graph
          </Link>
          <Link className="btn btn-ghost" href={`${base}/timeline`}>
            Timeline
          </Link>
        </div>
        {repo?.lastError ? <p className="error">{repo.lastError}</p> : null}
      </section>

      <section className="panel">
        <h2 className="section-title">Tip metrics</h2>
        {summary ? (
          <div className="metric-cards">
            <div className="metric-card">
              <div className="label">Cycles</div>
              <div className="metric-value">{summary.cycleCount}</div>
            </div>
            <div className="metric-card">
              <div className="label">Packages</div>
              <div className="metric-value">{summary.packageCount}</div>
            </div>
            <div className="metric-card">
              <div className="label">Files</div>
              <div className="metric-value">{summary.fileCount}</div>
            </div>
            <div className="metric-card">
              <div className="label">Avg fan-in</div>
              <div className="metric-value">{summary.avgFanIn.toFixed(1)}</div>
            </div>
            <div className="metric-card">
              <div className="label">Total LOC</div>
              <div className="metric-value">{Math.round(summary.totalLoc)}</div>
            </div>
          </div>
        ) : (
          <p className="muted">
            Metrics appear after the metrics_write job completes for this tip.
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Recent structural events</h2>
        {highEvents.length === 0 ? (
          <p className="muted">No medium/high events yet.</p>
        ) : (
          <ul className="event-list">
            {highEvents.slice(0, 8).map((e) => (
              <li key={e.id}>
                <Link
                  href={`${base}/compare?from=${e.fromSha}&to=${e.toSha}`}
                  className="event-row"
                >
                  <span className={`sev sev-${e.severity}`}>{e.severity}</span>
                  <span>{e.title}</span>
                  <span className="muted mono">
                    {e.fromSha.slice(0, 7)}→{e.toSha.slice(0, 7)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
