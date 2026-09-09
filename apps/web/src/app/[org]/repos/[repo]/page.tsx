'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/** Legacy repo root → overview (preserve runId). */
export default function RepoIndexRedirect() {
  const params = useParams<{ org: string; repo: string }>();
  const search = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const qs = search.toString();
    router.replace(
      `/${params.org}/repos/${params.repo}/overview${qs ? `?${qs}` : ''}`,
    );
  }, [params.org, params.repo, router, search]);

  return <p className="muted">Opening overview…</p>;
}
