'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, clearToken, getToken, type Org, type Repo } from '@/lib/api';

export default function ReposPage() {
  const params = useParams<{ org: string }>();
  const router = useRouter();
  const orgSlug = params.org;
  const [remoteUrl, setRemoteUrl] = useState('https://github.com/octocat/Hello-World.git');
  const [defaultBranch, setDefaultBranch] = useState('master');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
  }, [router]);

  const orgQuery = useQuery({
    queryKey: ['org', orgSlug],
    queryFn: () => api<Org>(`/v1/orgs/by-slug/${orgSlug}`),
  });

  const reposQuery = useQuery({
    queryKey: ['repos', orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () => api<Repo[]>(`/v1/repos?orgId=${orgQuery.data!.id}`),
    refetchInterval: 4_000,
  });

  async function onConnect(e: FormEvent) {
    e.preventDefault();
    if (!orgQuery.data) return;
    setSubmitting(true);
    setError(null);
    try {
      const repo = await api<Repo>('/v1/repos', {
        method: 'POST',
        body: JSON.stringify({
          orgId: orgQuery.data.id,
          remoteUrl,
          defaultBranch,
        }),
      });
      const analyzed = await api<{ run: { id: string } }>(
        `/v1/repos/${repo.id}/analyze?orgId=${orgQuery.data.id}`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      router.push(`/${orgSlug}/repos/${repo.id}?runId=${analyzed.run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect repo');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 className="brand rise">Git With It</h1>
          <p className="lede rise-delay">
            Org <span className="mono">{orgSlug}</span>
            {orgQuery.data ? ` · ${orgQuery.data.name}` : ''}
          </p>
        </div>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => {
            clearToken();
            router.push('/login');
          }}
        >
          Sign out
        </button>
      </div>

      <section className="panel rise-delay">
        <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 1rem' }}>Connect repo</h2>
        <form className="stack" onSubmit={onConnect}>
          <div>
            <label className="label" htmlFor="remoteUrl">
              Remote URL
            </label>
            <input
              id="remoteUrl"
              className="field"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="branch">
              Default branch
            </label>
            <input
              id="branch"
              className="field"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              required
            />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={submitting || !orgQuery.data}>
              {submitting ? 'Connecting…' : 'Connect & clone'}
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>

      <section className="panel">
        <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 1rem' }}>Repositories</h2>
        {reposQuery.isLoading ? <p className="muted">Loading…</p> : null}
        <ul className="repo-list">
          {(reposQuery.data ?? []).map((repo) => (
            <li key={repo.id} className="repo-item">
              <Link href={`/${orgSlug}/repos/${repo.id}`}>
                <span className="mono">{repo.remoteUrl}</span>
              </Link>
              <div className="row">
                <span className={`status ${repo.status}`}>{repo.status}</span>
                {repo.lastSyncedSha ? (
                  <span className="muted mono">{repo.lastSyncedSha.slice(0, 8)}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {reposQuery.data?.length === 0 ? (
          <p className="muted">No repositories yet. Connect one above.</p>
        ) : null}
      </section>
    </main>
  );
}
