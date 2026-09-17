'use client';

import { FormEvent, Suspense, useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setToken, type Org } from '@/lib/api';
import { preferWorkspaceSlug } from '@/lib/orgs';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const inviteToken = search.get('invite') ?? '';

  const [email, setEmail] = useState('admin@git-with-it.local');
  const [password, setPassword] = useState('admin1234');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        throw new Error('Invalid email or password');
      }

      const session = await getSession();
      if (typeof session?.accessToken === 'string' && session.accessToken.length > 0) {
        setToken(session.accessToken);
      } else {
        const login = await api<{ accessToken: string }>('/v1/auth/login', {
          method: 'POST',
          auth: false,
          body: JSON.stringify({ email, password }),
        });
        setToken(login.accessToken);
      }

      if (inviteToken) {
        const org = await api<Org>('/v1/orgs/invites/accept', {
          method: 'POST',
          body: JSON.stringify({ token: inviteToken }),
        });
        router.push(`/${org.slug}/repos`);
        return;
      }

      const orgs = await api<Org[]>('/v1/orgs');
      const slug = preferWorkspaceSlug(orgs);
      if (!slug) {
        throw new Error('No workspace found — try signing up');
      }
      router.push(`/${slug}/repos`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <h1 className="brand rise">Git With It</h1>
      <p className="lede rise-delay">
        {inviteToken
          ? 'Sign in to accept your team invite.'
          : 'Sign in to connect a repository and watch a bare clone land in object storage.'}
      </p>
      <form className="panel stack rise-delay" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          <Link
            className="btn btn-ghost"
            href={inviteToken ? `/signup?invite=${inviteToken}` : '/signup'}
          >
            Create account
          </Link>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="shell">Loading…</main>}>
      <LoginForm />
    </Suspense>
  );
}
