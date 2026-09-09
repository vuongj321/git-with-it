import { z } from 'zod';

export const AnalysisRunStatus = z.enum([
  'queued',
  'cloning',
  'uploading',
  'ready',
  'enumerating',
  'parsing',
  'graph_writing',
  'graph_ready',
  'metrics_writing',
  'evolving',
  'evolution_ready',
  'failed',
]);
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatus>;

export const RepositoryStatus = z.enum([
  'pending',
  'cloning',
  'ready',
  'failed',
]);
export type RepositoryStatus = z.infer<typeof RepositoryStatus>;

export const JobType = z.enum([
  'clone',
  'enumerate_sample',
  'parse',
  'parse_commit',
  'graph_write',
  'graph_write_delta',
  'checkpoint',
  'metrics_write',
  'evolve',
]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum([
  'queued',
  'active',
  'completed',
  'failed',
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const EntityKind = z.enum([
  'package',
  'file',
  'class',
  'interface',
  'function',
  'method',
  'variable',
]);
export type EntityKind = z.infer<typeof EntityKind>;

export const EvolutionEventType = z.enum([
  'dependency_added',
  'dependency_removed',
  'cycle_introduced',
  'cycle_resolved',
  'module_added',
  'module_removed',
  'rename_detected',
  'coupling_spike',
]);
export type EvolutionEventType = z.infer<typeof EvolutionEventType>;

export const EvolutionSeverity = z.enum(['info', 'low', 'medium', 'high']);
export type EvolutionSeverity = z.infer<typeof EvolutionSeverity>;

export const MembershipRole = z.enum(['owner', 'admin', 'member']);
export type MembershipRole = z.infer<typeof MembershipRole>;

export const SampleConfigSchema = z.object({
  /** Always include tip. Last N first-parent commits (default 100). */
  lastN: z.number().int().min(1).max(10_000).default(100),
  /** One calendar-month anchor beyond the window. */
  monthlyAnchors: z.boolean().default(true),
  /** Checkpoint every K sampled commits. */
  checkpointEvery: z.number().int().min(1).max(500).default(25),
  /** Max hops for compare without checkpoint path. */
  maxCompareHops: z.number().int().min(1).max(2000).default(200),
  /** Fan-in/out delta threshold for coupling_spike. */
  couplingDeltaThreshold: z.number().int().min(1).default(5),
});
export type SampleConfig = z.infer<typeof SampleConfigSchema>;

export const CreateRepoBodySchema = z.object({
  remoteUrl: z.string().url(),
  defaultBranch: z.string().min(1).optional(),
  orgId: z.string().uuid(),
  visibility: z.enum(['public', 'private']).optional().default('public'),
});
export type CreateRepoBody = z.infer<typeof CreateRepoBodySchema>;

export const CreateOrgBodySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
export type CreateOrgBody = z.infer<typeof CreateOrgBodySchema>;

export const CloneJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  remoteUrl: z.string().url(),
  defaultBranch: z.string().min(1),
  /** Encrypted PAT ciphertext; undefined for public remotes */
  encryptedPat: z.string().optional(),
});
export type CloneJobPayload = z.infer<typeof CloneJobPayloadSchema>;

export const EnumerateSampleJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  cloneUri: z.string().min(1),
  tipSha: z.string().min(7),
  analyzerVersion: z.string().min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});
export type EnumerateSampleJobPayload = z.infer<
  typeof EnumerateSampleJobPayloadSchema
>;

export const ParseJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  commitSha: z.string().min(7),
  cloneUri: z.string().min(1),
  analyzerVersion: z.string().min(1),
});
export type ParseJobPayload = z.infer<typeof ParseJobPayloadSchema>;

/** Multi-commit evolution parse (one sample or a batch). */
export const ParseCommitJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  cloneUri: z.string().min(1),
  analyzerVersion: z.string().min(1),
  /** Sampled SHAs oldest→newest. */
  sampleShas: z.array(z.string().min(7)).min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});
export type ParseCommitJobPayload = z.infer<typeof ParseCommitJobPayloadSchema>;

export const GraphWriteJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  commitSha: z.string().min(7),
  analyzerVersion: z.string().min(1),
});
export type GraphWriteJobPayload = z.infer<typeof GraphWriteJobPayloadSchema>;

export const MetricsWriteJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  sampleShas: z.array(z.string().min(7)).min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});
export type MetricsWriteJobPayload = z.infer<typeof MetricsWriteJobPayloadSchema>;

export const EvolveJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  sampleShas: z.array(z.string().min(7)).min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});
export type EvolveJobPayload = z.infer<typeof EvolveJobPayloadSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const OrganizationDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
});
export type OrganizationDto = z.infer<typeof OrganizationDtoSchema>;

export const RepositoryDtoSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  remoteUrl: z.string(),
  defaultBranch: z.string(),
  visibility: z.enum(['public', 'private']),
  status: RepositoryStatus,
  cloneUri: z.string().nullable(),
  lastSyncedSha: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RepositoryDto = z.infer<typeof RepositoryDtoSchema>;

export const AnalysisRunDtoSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  status: AnalysisRunStatus,
  analyzerVersion: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  sampleShas: z.array(z.string()).optional(),
  commitsDone: z.number().int().optional(),
  commitsTotal: z.number().int().optional(),
  triggeredBy: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type AnalysisRunDto = z.infer<typeof AnalysisRunDtoSchema>;

export const EntityDtoSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  kind: EntityKind,
  fqn: z.string(),
  name: z.string(),
  language: z.string().nullable(),
  status: z.string(),
});
export type EntityDto = z.infer<typeof EntityDtoSchema>;

export const GraphNodeSchema = z.object({
  id: z.string(),
  kind: z.string(),
  fqn: z.string(),
  name: z.string(),
  path: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  package: z.string().nullable().optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  rel: z.string(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphSnapshotSchema = z.object({
  repo_id: z.string().optional(),
  repoId: z.string().optional(),
  sha: z.string(),
  analyzer_version: z.string().optional(),
  analyzerVersion: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;

export const GraphDiffSchema = z.object({
  fromSha: z.string(),
  toSha: z.string(),
  nodesAdded: z.array(GraphNodeSchema),
  nodesRemoved: z.array(GraphNodeSchema),
  nodesRenamed: z.array(
    z.object({
      fromId: z.string(),
      toId: z.string(),
      fromFqn: z.string().optional(),
      toFqn: z.string().optional(),
      confidence: z.number(),
    }),
  ),
  edgesAdded: z.array(GraphEdgeSchema),
  edgesRemoved: z.array(GraphEdgeSchema),
  sccsAdded: z.array(z.array(z.string())),
  sccsRemoved: z.array(z.array(z.string())),
  fanInDeltas: z.array(
    z.object({ id: z.string(), from: z.number(), to: z.number(), delta: z.number() }),
  ),
  fanOutDeltas: z.array(
    z.object({ id: z.string(), from: z.number(), to: z.number(), delta: z.number() }),
  ),
  highlightIds: z.array(z.string()),
});
export type GraphDiff = z.infer<typeof GraphDiffSchema>;

/** Reject obviously non-git HTTPS URLs early (unit-tested). */
export function isLikelyGitRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    if (!parsed.hostname) return false;
    // Allow github/gitlab/bitbucket or any https ending in .git / path segments
    return parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

export {
  ANALYZER_VERSION,
  entityId,
  GWI_ENTITY_NAMESPACE,
  uuidv5,
  type EntityKindForId,
} from './entity-id';

export {
  sampleFirstParentCommits,
  type WalkedCommit,
  type SampledCommit,
  type SamplePolicy,
} from './sampling';

export {
  diffGraphs,
  findSccs,
  edgeKey,
  type DiffOptions,
  type GraphDiff as GraphDiffType,
  type GraphNode as GraphNodeType,
  type GraphEdge as GraphEdgeType,
  type GraphSnapshot as GraphSnapshotType,
} from './graph-diff';

export {
  eventsFromDiff,
  DEFAULT_EVENT_RULES,
  type EventRuleConfig,
  type EvolutionEventDraft,
} from './evolution-events';

export {
  METRIC_NAMES,
  computeMetrics,
  complexityProxyFromSource,
  maintainabilityProxy,
  summarizeMetrics,
  type MetricName,
  type MetricRow,
  type FileStat,
  type ComputeMetricsInput,
  type MetricsSummary,
} from './metrics';
