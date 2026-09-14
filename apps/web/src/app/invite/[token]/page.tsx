'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, getToken, type InvitePreview, type Org } from '@/lib/api';

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/signup?invite=${encodeURIComponent(token)}`);
      return;
    }
    setAuthed(true);
  }, [router, token]);

  const preview = useQuery({
    queryKey: ['invite-preview', token],
    enabled: Boolean(token) && authed,
    queryFn: () => api<InvitePreview>(`/v1/orgs/invites/preview?token=${encodeURIComponent(token)}`),
    retry: false,
  });

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const org = await api<Org>('/v1/orgs/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      router.push(`/${org.slug}/repos`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invite');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <h1 className="brand rise">Team invite</h1>
      <p className="lede rise-delay">Join a shared analysis workspace.</p>
      <section className="panel stack rise-delay">
        {!authed ? <p className="muted">Redirecting…</p> : null}
        {authed && preview.isLoading ? <p className="muted">Loading invite…</p> : null}
        {preview.isError ? (
          <p className="error">
            Invite unavailable. Sign in with the invited email, or ask for a new link.
          </p>
        ) : null}
        {preview.data ? (
          <>
            <p>
              You&apos;re invited to <strong>{preview.data.orgName}</strong> (
              <span className="mono">{preview.data.orgSlug}</span>) as{' '}
              <span className="mono">{preview.data.role}</span>.
            </p>
            <p className="muted">
              Invited email: <span className="mono">{preview.data.email}</span>
            </p>
            <div className="row">
              <button className="btn" type="button" disabled={pending} onClick={accept}>
                {pending ? 'Joining…' : 'Accept invite'}
              </button>
              <Link className="btn btn-ghost" href={`/login?invite=${encodeURIComponent(token)}`}>
                Switch account
              </Link>
            </div>
          </>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
