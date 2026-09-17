'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import {
  api,
  clearToken,
  getToken,
  type Org,
  type OrgInvite,
  type Repo,
} from '@/lib/api';

export default function ReposPage() {
  const params = useParams<{ org: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSlug = params.org;
  const [remoteUrl, setRemoteUrl] = useState('https://github.com/octocat/Hello-World.git');
  const [defaultBranch, setDefaultBranch] = useState('master');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
  }, [router]);

  const orgQuery = useQuery({
    queryKey: ['org', orgSlug],
    queryFn: () => api<Org>(`/v1/orgs/by-slug/${orgSlug}`),
  });

  const orgsQuery = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api<Org[]>('/v1/orgs'),
  });

  const reposQuery = useQuery({
    queryKey: ['repos', orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () => api<Repo[]>(`/v1/repos?orgId=${orgQuery.data!.id}`),
    refetchInterval: 4_000,
  });

  const canManageInvites =
    orgQuery.data?.kind === 'team' &&
    (orgQuery.data.role === 'owner' || orgQuery.data.role === 'admin');

  const invitesQuery = useQuery({
    queryKey: ['invites', orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id) && canManageInvites,
    queryFn: () => api<OrgInvite[]>(`/v1/orgs/${orgQuery.data!.id}/invites`),
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
      router.push(`/${orgSlug}/repos/${repo.id}/overview?runId=${analyzed.run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect repo');
    } finally {
      setSubmitting(false);
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!orgQuery.data) return;
    setInviteBusy(true);
    setInviteError(null);
    setLastAcceptUrl(null);
    try {
      const created = await api<OrgInvite>(`/v1/orgs/${orgQuery.data.id}/invites`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setLastAcceptUrl(created.acceptUrl ?? null);
      setInviteEmail('');
      await queryClient.invalidateQueries({ queryKey: ['invites', orgQuery.data.id] });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!orgQuery.data) return;
    setInviteError(null);
    try {
      await api(`/v1/orgs/${orgQuery.data.id}/invites/${inviteId}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['invites', orgQuery.data.id] });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

  return (
    <main className="shell">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 className="brand rise">Git With It</h1>
          <p className="lede rise-delay">
            {orgQuery.data?.kind === 'personal' ? 'Personal workspace' : 'Org'}{' '}
            <span className="mono">{orgSlug}</span>
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

      {(orgsQuery.data?.length ?? 0) > 1 ? (
        <section className="panel">
          <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 0.75rem' }}>Workspaces</h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            {(orgsQuery.data ?? []).map((o) => (
              <Link
                key={o.id}
                className={o.slug === orgSlug ? 'btn' : 'btn btn-ghost'}
                href={`/${o.slug}/repos`}
              >
                {o.kind === 'personal' ? 'Personal' : o.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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
              <Link href={`/${orgSlug}/repos/${repo.id}/overview`}>
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

      {canManageInvites ? (
        <section className="panel stack">
          <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>Invite teammates</h2>
          <p className="muted" style={{ margin: 0 }}>
            Share this team&apos;s analysis. Copy the invite link (no email delivery in MVP).
          </p>
          <form className="stack" onSubmit={onInvite}>
            <div>
              <label className="label" htmlFor="inviteEmail">
                Email
              </label>
              <input
                id="inviteEmail"
                className="field"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="inviteRole">
                Role
              </label>
              <select
                id="inviteRole"
                className="field"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button className="btn" type="submit" disabled={inviteBusy}>
              {inviteBusy ? 'Creating…' : 'Create invite'}
            </button>
          </form>
          {lastAcceptUrl ? (
            <p className="mono" style={{ wordBreak: 'break-all' }}>
              {lastAcceptUrl}
            </p>
          ) : null}
          {inviteError ? <p className="error">{inviteError}</p> : null}
          <ul className="repo-list">
            {(invitesQuery.data ?? []).map((inv) => (
              <li key={inv.id} className="repo-item">
                <div>
                  <span className="mono">{inv.email}</span>{' '}
                  <span className="muted">
                    · {inv.role} · {inv.status}
                  </span>
                </div>
                {inv.status === 'pending' ? (
                  <button className="btn btn-ghost" type="button" onClick={() => revokeInvite(inv.id)}>
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
