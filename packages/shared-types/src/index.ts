import { z } from 'zod';

export const AnalysisRunStatus = z.enum([
  'queued',
  'cloning',
  'uploading',
  'ready',
  'parsing',
  'graph_writing',
  'graph_ready',
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

export const JobType = z.enum(['clone', 'parse', 'graph_write']);
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

export const MembershipRole = z.enum(['owner', 'admin', 'member']);
export type MembershipRole = z.infer<typeof MembershipRole>;

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

export const GraphWriteJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  repoId: z.string().uuid(),
  orgId: z.string().uuid(),
  commitSha: z.string().min(7),
  analyzerVersion: z.string().min(1),
});
export type GraphWriteJobPayload = z.infer<typeof GraphWriteJobPayloadSchema>;

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
