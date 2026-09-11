'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Internal state keys that differ from their URL query param names. */
const STATE_TO_PARAM: Record<string, string> = {
  eventType: 'type',
};

/** Shareable URL state for sha/compare/metric/view (ADR 0015). */
export function useRepoUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => ({
      sha: searchParams.get('sha') ?? '',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
      focus: searchParams.get('focus') ?? '',
      view: (searchParams.get('view') as 'package' | 'file' | null) ?? 'package',
      metric: searchParams.get('metric') ?? 'fan_in',
      depth: Number(searchParams.get('depth') ?? '1'),
      severity: searchParams.get('severity') ?? '',
      category: searchParams.get('category') ?? '',
      eventType: searchParams.get('type') ?? '',
    }),
    [searchParams],
  );

  const setState = useCallback(
    (patch: Partial<typeof state>, replace = true) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        const param = STATE_TO_PARAM[key] ?? key;
        if (value === '' || value == null) next.delete(param);
        else next.set(param, String(value));
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (replace) router.replace(href);
      else router.push(href);
    },
    [pathname, router, searchParams],
  );

  return { ...state, setState };
}
