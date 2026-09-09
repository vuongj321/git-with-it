'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, getToken, type Org, type Repo } from '@/lib/api';
import { RepoNav } from '@/components/RepoNav';

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ org: string; repo: string }>();
  const router = useRouter();

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
    refetchInterval: 5_000,
  });

  const repo = repoQuery.data;

  return (
    <main className="shell shell-wide">
      <p className="muted">
        <Link href={`/${params.org}/repos`}>← Repositories</Link>
      </p>
      <header className="repo-header rise">
        <div>
          <h1 className="brand" style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)' }}>
            Git With It
          </h1>
          <p className="lede mono" style={{ marginTop: '0.4rem' }}>
            {repo?.remoteUrl ?? '…'}
          </p>
        </div>
        {repo ? (
          <div className="row">
            <span className={`status ${repo.status}`}>{repo.status}</span>
            <span className="muted mono">{repo.defaultBranch}</span>
          </div>
        ) : null}
      </header>
      <RepoNav />
      <div className="repo-body rise-delay">{children}</div>
    </main>
  );
}
