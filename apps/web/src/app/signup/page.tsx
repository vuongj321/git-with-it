'use client';

import { FormEvent, Suspense, useMemo, useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setToken, type Org } from '@/lib/api';
import { preferWorkspaceSlug } from '@/lib/orgs';

function SignupForm() {
  const router = useRouter();
  const search = useSearchParams();
  const inviteToken = search.get('invite') ?? '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<'form' | 'choose'>('form');
  const [orgs, setOrgs] = useState<Org[]>([]);

  const personalSlug = useMemo(() => preferWorkspaceSlug(orgs), [orgs]);

  async function establishSession(emailValue: string, passwordValue: string) {
    const result = await signIn('credentials', {
      email: emailValue,
      password: passwordValue,
      redirect: false,
    });
    if (result?.error) {
      throw new Error('Account created but sign-in failed — try logging in');
    }
    const session = await getSession();
    if (typeof session?.accessToken === 'string' && session.accessToken.length > 0) {
      setToken(session.accessToken);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const register = await api<{ accessToken: string }>('/v1/auth/register', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          email,
          password,
          name: name.trim() || undefined,
          inviteToken: inviteToken || undefined,
        }),
      });
      setToken(register.accessToken);
      await establishSession(email, password);

      const list = await api<Org[]>('/v1/orgs');
      setOrgs(list);

      if (inviteToken) {
        const team = list.find((o) => o.kind === 'team');
        router.push(`/${team?.slug ?? preferWorkspaceSlug(list)}/repos`);
        return;
      }
      setStep('choose');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setPending(false);
    }
  }

  async function createTeam(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const teamName = String(fd.get('teamName') ?? '').trim();
    const slug = String(fd.get('slug') ?? '')
      .trim()
      .toLowerCase();
    try {
      const org = await api<Org>('/v1/orgs', {
        method: 'POST',
        body: JSON.stringify({ name: teamName, slug }),
      });
      router.push(`/${org.slug}/repos`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create team');
    } finally {
      setPending(false);
    }
  }

  if (step === 'choose') {
    return (
      <main className="shell">
        <h1 className="brand rise">You&apos;re in</h1>
        <p className="lede rise-delay">
          Your personal workspace is ready. Create a team to share analysis, or continue alone.
        </p>
        <section className="panel stack rise-delay">
          <button
            className="btn"
            type="button"
            disabled={!personalSlug}
            onClick={() => personalSlug && router.push(`/${personalSlug}/repos`)}
          >
            Continue to my workspace
          </button>
        </section>
        <section className="panel stack">
          <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>Create a team</h2>
          <p className="muted" style={{ margin: 0 }}>
            Optional — invite teammates later so everyone shares one analysis run.
          </p>
          <form className="stack" onSubmit={createTeam}>
            <div>
              <label className="label" htmlFor="teamName">
                Team name
              </label>
              <input id="teamName" name="teamName" className="field" required maxLength={120} />
            </div>
            <div>
              <label className="label" htmlFor="slug">
                URL slug
              </label>
              <input
                id="slug"
                name="slug"
                className="field"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                minLength={2}
                maxLength={64}
                placeholder="acme-eng"
              />
            </div>
            <button className="btn" type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create team'}
            </button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <h1 className="brand rise">Create account</h1>
      <p className="lede rise-delay">
        {inviteToken
          ? 'Sign up to join the team invite. You also get a personal workspace.'
          : 'Get a personal workspace immediately. Teams are optional.'}
      </p>
      <form className="panel stack rise-delay" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
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
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Sign up'}
          </button>
          <Link className="btn btn-ghost" href={inviteToken ? `/login?invite=${inviteToken}` : '/login'}>
            Sign in
          </Link>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<main className="shell">Loading…</main>}>
      <SignupForm />
    </Suspense>
  );
}
