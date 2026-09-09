'use client';

import { SessionProvider as NextAuthSessionProvider, useSession } from 'next-auth/react';
import { useEffect, type ReactNode } from 'react';
import { setToken } from '@/lib/api';

function SyncAccessToken({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    const token = session?.accessToken;
    if (typeof token === 'string' && token.length > 0) {
      setToken(token);
    }
  }, [session?.accessToken, status]);

  return children;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <SyncAccessToken>{children}</SyncAccessToken>
    </NextAuthSessionProvider>
  );
}
