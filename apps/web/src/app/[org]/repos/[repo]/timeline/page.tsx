'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api, type EvolutionEvent, type Org } from '@/lib/api';
import { useRepoUrlState } from '@/lib/url-state';

function monthKey(iso: string | null): string {
  if (!iso) return 'Unknown';
  return iso.slice(0, 7);
}

export default function TimelinePage() {
  const params = useParams<{ org: string; repo: string }>();
  const { severity, eventType, setState } = useRepoUrlState();
  const [visible, setVisible] = useState(80);
  const base = `/${params.org}/repos/${params.repo}`;

  const orgQuery = useQuery({
    queryKey: ['org', params.org],
    queryFn: () => api<Org>(`/v1/orgs/by-slug/${params.org}`),
  });

  const eventsQuery = useQuery({
    queryKey: ['timeline', params.repo, orgQuery.data?.id],
    enabled: Boolean(orgQuery.data?.id),
    queryFn: () =>
      api<EvolutionEvent[]>(
        `/v1/repos/${params.repo}/timeline?orgId=${orgQuery.data!.id}&limit=500`,
      ),
  });

  const filtered = useMemo(() => {
    let rows = eventsQuery.data ?? [];
    if (severity) rows = rows.filter((e) => e.severity === severity);
    if (eventType) rows = rows.filter((e) => e.type === eventType);
    return rows;
  }, [eventType, eventsQuery.data, severity]);

  const groups = useMemo(() => {
    const map = new Map<string, EvolutionEvent[]>();
    for (const e of filtered) {
      const key = monthKey(e.authoredAt);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const flat = filtered.slice(0, visible);

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="section-title">Architectural timeline</h2>
        <p className="muted">
          Structural events across sampled history — not a raw git log.
        </p>
        <div className="row" style={{ marginTop: '1rem' }}>
          <label className="chrome-field">
            <span className="label">Severity</span>
            <select
              className="field"
              value={severity}
              onChange={(e) => setState({ severity: e.target.value })}
            >
              <option value="">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </select>
          </label>
          <label className="chrome-field">
            <span className="label">Type</span>
            <select
              className="field"
              value={eventType}
              onChange={(e) => setState({ eventType: e.target.value })}
            >
              <option value="">All</option>
              <option value="cycle_introduced">cycle_introduced</option>
              <option value="cycle_resolved">cycle_resolved</option>
              <option value="dependency_added">dependency_added</option>
              <option value="dependency_removed">dependency_removed</option>
              <option value="module_added">module_added</option>
              <option value="module_removed">module_removed</option>
              <option value="rename_detected">rename_detected</option>
              <option value="coupling_spike">coupling_spike</option>
            </select>
          </label>
        </div>
      </section>

      {eventsQuery.isLoading ? <p className="muted">Loading events…</p> : null}

      {groups.map(([month, events]) => (
        <section key={month} className="panel">
          <h3 className="month-heading">{month}</h3>
          <ul className="event-list">
            {events
              .filter((e) => flat.some((f) => f.id === e.id))
              .map((e) => (
                <li key={e.id}>
                  <Link
                    href={`${base}/compare?from=${e.fromSha}&to=${e.toSha}`}
                    className="event-row"
                  >
                    <span className={`sev sev-${e.severity}`}>{e.severity}</span>
                    <span className="mono muted">{e.type}</span>
                    <span>{e.title}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {filtered.length > visible ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setVisible((v) => v + 80)}
        >
          Show more ({filtered.length - visible} remaining)
        </button>
      ) : null}
    </div>
  );
}
