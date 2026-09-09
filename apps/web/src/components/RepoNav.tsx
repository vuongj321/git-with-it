'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

const TABS = [
  { slug: 'overview', label: 'Overview' },
  { slug: 'graph', label: 'Graph' },
  { slug: 'timeline', label: 'Timeline' },
  { slug: 'metrics', label: 'Metrics' },
  { slug: 'compare', label: 'Compare' },
  { slug: 'insights', label: 'Insights' },
] as const;

export function RepoNav() {
  const params = useParams<{ org: string; repo: string }>();
  const pathname = usePathname();
  const base = `/${params.org}/repos/${params.repo}`;

  return (
    <nav className="repo-nav" aria-label="Repository sections">
      {TABS.map((tab) => {
        const href = `${base}/${tab.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.slug}
            href={href}
            className={`repo-nav-link${active ? ' active' : ''}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
