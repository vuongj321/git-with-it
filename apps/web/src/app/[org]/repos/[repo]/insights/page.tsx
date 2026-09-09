'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, type Insight, type Org, type Repo, type Run } from '@/lib/api';
import { useRepoUrlState } from '@/lib/url-state';

export default function InsightsPage() {
  const params = useParams<{ org: string; repo: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { severity, category, setState } = useRepoUrlState();
  const runId = search.get('runId');
  const base = `/${params.org}/repos/${params.repo}`;

  const orgQuery = useQuery({
    queryKey: ['org', params.org],
    queryFn: () => api<Org>(`/v1/orgs/by-slug/${params.org}`),
  });

  const repoQuery = useQuery({
    queryKey: ['repo', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () => api<Repo>(`/v1/repos/${params.repo}?orgId=${orgQuery.data!.id}`),
  });

  const runQuery = useQuery({
    queryKey: ['run-insights', params.repo, runId, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && runId),
    queryFn: () =>
      api<Run>(`/v1/repos/${params.repo}/runs/${runId}?orgId=${orgQuery.data!.id}`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (!status || status === 'evolution_ready' || status === 'failed') return false;
      return 2_000;
    },
  });

  const query = new URLSearchParams();
  if (orgQuery.data?.id) query.set('orgId', orgQuery.data.id);
  if (severity) query.set('severity', severity);
  if (category) query.set('category', category);
  query.set('limit', '50');

  const insightsQuery = useQuery({
    queryKey: ['insights', params.repo, orgQuery.data?.id, severity, category],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () => api<Insight[]>(`/v1/repos/${params.repo}/insights?${query.toString()}`),
    refetchInterval: runQuery.data?.status === 'ai_generating' ? 3_000 : false,
  });

  async function regenerate() {
    if (!orgQuery.data || !runId) return;
    await api(`/v1/repos/${params.repo}/runs/${runId}/insights/regenerate?orgId=${orgQuery.data.id}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    router.refresh();
  }

  const run = runQuery.data;
  const aiDisabled = repoQuery.data && run?.status !== 'ai_generating' && insightsQuery.data?.length === 0;

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="section-title">Insights</h2>
        <p className="lede">
          Based on measured signals. Each insight is grounded in sampled metrics,
          graph diffs, and evolution events.
        </p>
        <div className="row" style={{ marginTop: '1rem' }}>
          <label className="chrome-field">
            <span className="label">Severity</span>
            <select
              className="field"
              value={severity}
              onChange={(e) => setState({ severity: e.target.value })}
            >
              <option value="">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="chrome-field">
            <span className="label">Category</span>
            <select
              className="field"
              value={category}
              onChange={(e) => setState({ category: e.target.value })}
            >
              <option value="">All</option>
              <option value="risk">risk</option>
              <option value="drift">drift</option>
              <option value="debt">debt</option>
              <option value="refactor">refactor</option>
              <option value="hotspot">hotspot</option>
            </select>
          </label>
          {runId ? (
            <button type="button" className="btn btn-ghost" onClick={() => void regenerate()}>
              Regenerate
            </button>
          ) : null}
        </div>
      </section>

      {run?.status === 'ai_generating' ? (
        <section className="panel">
          <p className="muted">AI job is running for this analysis. Feed updates automatically.</p>
        </section>
      ) : null}

      {aiDisabled ? (
        <section className="panel">
          <p className="muted">
            AI disabled or no provider configured. Candidates and evidence can still be generated,
            but no published insight narratives are available.
          </p>
        </section>
      ) : null}

      {(insightsQuery.data ?? []).map((insight) => (
        <section key={insight.id} className="panel">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 className="section-title" style={{ marginBottom: '0.5rem' }}>
                {insight.headline}
              </h3>
              <p className="muted">
                <span className={`sev sev-${insight.severity}`}>{insight.severity}</span>{' '}
                <span className="mono">{insight.category}</span>{' '}
                <span className="mono">{Math.round(insight.confidence * 100)}%</span>
              </p>
            </div>
            <p className="muted mono">
              {insight.fromSha.slice(0, 7)}→{insight.toSha.slice(0, 7)}
            </p>
          </div>
          <p style={{ marginTop: '1rem' }}>{insight.narrative}</p>
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Cited signals: {insight.citedSignals.join(', ')}
          </p>
          {insight.suggestedActions.length ? (
            <ul className="event-list" style={{ marginTop: '1rem' }}>
              {insight.suggestedActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          ) : null}
          <div className="row" style={{ marginTop: '1rem' }}>
            <Link className="btn btn-ghost" href={`${base}/compare?from=${insight.fromSha}&to=${insight.toSha}`}>
              View compare
            </Link>
            <Link
              className="btn btn-ghost"
              href={`${base}/graph?sha=${insight.toSha}&focus=${insight.entityIds[0] ?? ''}`}
            >
              View in graph
            </Link>
            <Link className="btn btn-ghost" href={`${base}/metrics?sha=${insight.toSha}`}>
              View metrics
            </Link>
          </div>
        </section>
      ))}

      {!insightsQuery.isLoading && (insightsQuery.data ?? []).length === 0 && !aiDisabled ? (
        <section className="panel">
          <p className="muted">No insights matched the current filters.</p>
        </section>
      ) : null}
    </div>
  );
}
