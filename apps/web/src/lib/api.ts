const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'gwi_access_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  const cleaned = token.replace(/^Bearer\s+/i, '').trim();
  localStorage.setItem(TOKEN_KEY, cleaned);
}

export function clearToken() {
  localStorage.setItem(TOKEN_KEY, '');
  localStorage.removeItem(TOKEN_KEY);
}

async function tokenFromSession(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const { getSession } = await import('next-auth/react');
    const session = await getSession();
    const fromSession =
      typeof session?.accessToken === 'string' && session.accessToken.length > 0
        ? session.accessToken
        : null;
    if (fromSession) setToken(fromSession);
    return fromSession;
  } catch {
    return null;
  }
}

/** Prefer localStorage; fall back to NextAuth session.accessToken (login may only set the cookie). */
async function resolveAccessToken(opts?: { preferSession?: boolean }): Promise<string | null> {
  if (!opts?.preferSession) {
    const existing = getToken();
    if (existing) return existing;
  }
  return tokenFromSession();
}

export async function api<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const useAuth = init.auth !== false;
  if (useAuth) {
    const token = await resolveAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }
  let res = await fetch(`${API_URL}${path}`, { ...init, headers });
  // Stale localStorage JWT with a fresh NextAuth session — refresh once.
  if (useAuth && res.status === 401) {
    clearToken();
    const refreshed = await resolveAccessToken({ preferSession: true });
    if (refreshed) {
      headers.set('authorization', `Bearer ${refreshed}`);
      res = await fetch(`${API_URL}${path}`, { ...init, headers });
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export type Org = { id: string; name: string; slug: string; createdAt: string };
export type Repo = {
  id: string;
  orgId: string;
  remoteUrl: string;
  defaultBranch: string;
  visibility: 'public' | 'private';
  status: string;
  cloneUri: string | null;
  lastSyncedSha: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Run = {
  id: string;
  repoId: string;
  status: string;
  analyzerVersion?: string | null;
  commitSha?: string | null;
  sampleShas?: string[];
  commitsDone?: number;
  commitsTotal?: number;
  triggeredBy: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SampleCommit = {
  sha: string;
  topoIndex: number | null;
  reason?: string;
  message: string | null;
  authoredAt: string | null;
};

export type EvolutionEvent = {
  id: string;
  type: string;
  severity: string;
  title: string;
  fromSha: string;
  toSha: string;
  authoredAt: string | null;
  payload?: Record<string, unknown>;
  entityIds?: string[];
};

export type GraphNodeDto = {
  id: string;
  kind: string;
  fqn: string;
  name: string;
  path?: string | null;
  package?: string | null;
};

export type GraphEdgeDto = {
  from: string;
  to: string;
  rel: string;
};

export type GraphSlice = {
  sha: string;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  truncated?: boolean;
};

export type MetricsSummary = {
  sha: string;
  cycleCount: number;
  packageCount: number;
  fileCount: number;
  avgFanIn: number;
  avgComplexity: number;
  totalLoc: number;
};

export type MetricSeriesResponse = {
  repoId: string;
  series: Array<{
    metric: string;
    entityId: string;
    points: Array<{
      commitSha: string;
      topoIndex: number;
      authoredAt: string | null;
      value: number;
    }>;
  }>;
};

export type HeatmapResponse = {
  sha: string;
  metric: string;
  view: string;
  values: Array<{ entityId: string; value: number; fqn?: string | null; graphId?: string }>;
};

export type MetricsDeltaResponse = {
  from: string;
  to: string;
  movers: Array<{
    entityId: string;
    entityKind: string;
    metric: string;
    fromValue: number;
    toValue: number;
    delta: number;
  }>;
};

export type GraphDiffPayload = {
  fromSha?: string;
  toSha?: string;
  nodesAdded?: GraphNodeDto[];
  nodesRemoved?: GraphNodeDto[];
  edgesAdded?: GraphEdgeDto[];
  edgesRemoved?: GraphEdgeDto[];
  highlightIds?: string[];
  highlight_subgraph?: string[];
};

export type Insight = {
  id: string;
  repoId: string;
  runId: string | null;
  headline: string;
  narrative: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'debt' | 'drift' | 'risk' | 'refactor' | 'hotspot';
  entityIds: string[];
  fromSha: string;
  toSha: string;
  evidenceHash: string;
  model: string | null;
  provider: string | null;
  promptHash: string | null;
  confidence: number;
  status: 'published' | 'failed_validation' | 'skipped_no_provider';
  suggestedActions: string[];
  citedSignals: string[];
  createdAt: string;
};
