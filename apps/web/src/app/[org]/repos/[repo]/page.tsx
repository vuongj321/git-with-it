'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, getToken, type Org, type Repo, type Run } from '@/lib/api';

export default function RepoDetailPage() {
  const params = useParams<{ org: string; repo: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const runId = search.get('runId');

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
      if (status === 'ready' || status === 'failed') return false;
      return 2_000;
    },
  });

  async function reanalyze() {
    if (!orgQuery.data) return;
    const analyzed = await api<{ run: { id: string } }>(
      `/v1/repos/${params.repo}/analyze?orgId=${orgQuery.data.id}`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    router.replace(`/${params.org}/repos/${params.repo}?runId=${analyzed.run.id}`);
  }

  const repo = repoQuery.data;
  const run = runQuery.data;

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
              Re-analyze (clone)
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
              {run.error ? <p className="error">{run.error}</p> : null}
            </div>
          ) : (
            <p className="muted">Waiting for run status…</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
