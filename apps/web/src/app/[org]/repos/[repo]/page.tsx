'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, getToken, type Org, type Repo, type Run } from '@/lib/api';

type SampleCommit = {
  sha: string;
  topoIndex: number | null;
  reason?: string;
  message: string | null;
  authoredAt: string | null;
};

type EvolutionEvent = {
  id: string;
  type: string;
  severity: string;
  title: string;
  fromSha: string;
  toSha: string;
  authoredAt: string | null;
};

export default function RepoDetailPage() {
  const params = useParams<{ org: string; repo: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const runId = search.get('runId');
  const [fromSha, setFromSha] = useState('');
  const [toSha, setToSha] = useState('');
  const [diffJson, setDiffJson] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
  }, [router]);

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
      if (
        status === 'evolution_ready' ||
        status === 'graph_ready' ||
        status === 'failed'
      ) {
        return status === 'graph_ready' ? 3_000 : false;
      }
      return 2_000;
    },
  });

  const commitsQuery = useQuery({
    queryKey: ['commits', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && repoQuery.data?.lastSyncedSha),
    queryFn: () =>
      api<SampleCommit[]>(
        `/v1/repos/${params.repo}/commits?orgId=${orgQuery.data!.id}&sampled=true`,
      ),
  });

  const timelineQuery = useQuery({
    queryKey: ['timeline', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id && repoQuery.data?.lastSyncedSha),
    queryFn: () =>
      api<EvolutionEvent[]>(
        `/v1/repos/${params.repo}/timeline?orgId=${orgQuery.data!.id}&limit=50`,
      ),
  });

  useEffect(() => {
    const list = commitsQuery.data;
    if (!list?.length) return;
    if (!fromSha) setFromSha(list[0]!.sha);
    if (!toSha) setToSha(list[list.length - 1]!.sha);
  }, [commitsQuery.data, fromSha, toSha]);

  async function reanalyze() {
    if (!orgQuery.data) return;
    const analyzed = await api<{ run: { id: string } }>(
      `/v1/repos/${params.repo}/analyze?orgId=${orgQuery.data.id}`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    router.replace(`/${params.org}/repos/${params.repo}?runId=${analyzed.run.id}`);
  }

  async function compare() {
    if (!orgQuery.data || !fromSha || !toSha) return;
    setDiffError(null);
    try {
      const result = await api<unknown>(
        `/v1/repos/${params.repo}/compare?orgId=${orgQuery.data.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ from: fromSha, to: toSha }),
        },
      );
      setDiffJson(JSON.stringify(result, null, 2));
    } catch (err) {
      setDiffJson(null);
      setDiffError(err instanceof Error ? err.message : String(err));
    }
  }

  const repo = repoQuery.data;
  const run = runQuery.data;
  const samples = commitsQuery.data ?? [];
  const events = timelineQuery.data ?? [];

  return (
    <main className="shell">
      <p className="muted">
        <Link href={`/${params.org}/repos`}>← Repositories</Link>
      </p>
      <h1 className="brand rise" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)' }}>
        Repository
      </h1>
      {repo ? (
        <div className="panel stack rise-delay">
          <div>
            <div className="label">Remote</div>
            <div className="mono">{repo.remoteUrl}</div>
          </div>
          <div className="row">
            <span className={`status ${repo.status}`}>{repo.status}</span>
            <span className="muted mono">{repo.defaultBranch}</span>
          </div>
          {repo.cloneUri ? (
            <div>
              <div className="label">Clone URI</div>
              <div className="mono">{repo.cloneUri}</div>
            </div>
          ) : null}
          {repo.lastSyncedSha ? (
            <div>
              <div className="label">Last synced SHA</div>
              <div className="mono">{repo.lastSyncedSha}</div>
            </div>
          ) : null}
          {repo.lastError ? <p className="error">{repo.lastError}</p> : null}
          <div className="row">
            <button className="btn" type="button" onClick={() => void reanalyze()}>
              Re-analyze
            </button>
          </div>
        </div>
      ) : (
        <p className="muted">Loading repository…</p>
      )}

      {runId ? (
        <section className="panel">
          <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 0.75rem' }}>
            Analysis run
          </h2>
          {run ? (
            <div className="stack">
              <div className="row">
                <span className={`status ${run.status}`}>{run.status}</span>
                <span className="muted mono">{run.id}</span>
              </div>
              {run.commitsTotal ? (
                <p className="muted">
                  Samples {run.commitsDone ?? 0}/{run.commitsTotal}
                </p>
              ) : null}
              {run.error ? <p className="error">{run.error}</p> : null}
            </div>
          ) : (
            <p className="muted">Waiting for run status…</p>
          )}
        </section>
      ) : null}

      {samples.length > 0 ? (
        <section className="panel stack">
          <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>
            Compare samples
          </h2>
          <p className="muted">First-parent sampled commits (oldest → tip).</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <label className="stack" style={{ gap: '0.25rem' }}>
              <span className="label">From</span>
              <select
                className="mono"
                value={fromSha}
                onChange={(e) => setFromSha(e.target.value)}
              >
                {samples.map((c) => (
                  <option key={`from-${c.sha}`} value={c.sha}>
                    {(c.sha).slice(0, 10)} {c.message?.slice(0, 40) ?? ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: '0.25rem' }}>
              <span className="label">To</span>
              <select
                className="mono"
                value={toSha}
                onChange={(e) => setToSha(e.target.value)}
              >
                {samples.map((c) => (
                  <option key={`to-${c.sha}`} value={c.sha}>
                    {(c.sha).slice(0, 10)} {c.message?.slice(0, 40) ?? ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="button" onClick={() => void compare()}>
              Compare
            </button>
          </div>
          {diffError ? <p className="error">{diffError}</p> : null}
          {diffJson ? (
            <pre
              className="mono"
              style={{
                maxHeight: 320,
                overflow: 'auto',
                fontSize: '0.75rem',
                margin: 0,
              }}
            >
              {diffJson}
            </pre>
          ) : null}
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="panel stack">
          <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>
            Evolution timeline
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th align="left">Type</th>
                <th align="left">Severity</th>
                <th align="left">Title</th>
                <th align="left">Range</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.type}</td>
                  <td>{e.severity}</td>
                  <td>{e.title}</td>
                  <td className="mono">
                    {e.fromSha.slice(0, 7)}…{e.toSha.slice(0, 7)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}
