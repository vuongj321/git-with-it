import type { Org } from './api';

/** Prefer personal workspace; otherwise first membership. */
export function preferWorkspaceSlug(orgs: Array<Pick<Org, 'slug' | 'kind'>>): string | null {
  const personal = orgs.find((o) => o.kind === 'personal');
  return personal?.slug ?? orgs[0]?.slug ?? null;
}
