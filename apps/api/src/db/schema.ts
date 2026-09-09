import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  integer,
  bigint,
  jsonb,
  pgEnum,
  index,
  doublePrecision,
  boolean,
} from 'drizzle-orm/pg-core';

export const membershipRoleEnum = pgEnum('membership_role', [
  'owner',
  'admin',
  'member',
]);

export const repoVisibilityEnum = pgEnum('repo_visibility', ['public', 'private']);

export const repoStatusEnum = pgEnum('repo_status', [
  'pending',
  'cloning',
  'ready',
  'failed',
]);

export const runStatusEnum = pgEnum('run_status', [
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
  'ai_generating',
  'evolution_ready',
  'failed',
]);

export const jobTypeEnum = pgEnum('job_type', [
  'clone',
  'enumerate_sample',
  'parse',
  'parse_commit',
  'graph_write',
  'graph_write_delta',
  'checkpoint',
  'metrics_write',
  'evolve',
  'ai',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'active',
  'completed',
  'failed',
]);

export const entityKindEnum = pgEnum('entity_kind', [
  'package',
  'file',
  'class',
  'interface',
  'function',
  'method',
  'variable',
]);

export const evolutionEventTypeEnum = pgEnum('evolution_event_type', [
  'dependency_added',
  'dependency_removed',
  'cycle_introduced',
  'cycle_resolved',
  'module_added',
  'module_removed',
  'rename_detected',
  'coupling_spike',
]);

export const evolutionSeverityEnum = pgEnum('evolution_severity', [
  'info',
  'low',
  'medium',
  'high',
]);

export const insightSeverityEnum = pgEnum('insight_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const insightCategoryEnum = pgEnum('insight_category', [
  'debt',
  'drift',
  'risk',
  'refactor',
  'hotspot',
]);

export const insightStatusEnum = pgEnum('insight_status', [
  'published',
  'failed_validation',
  'skipped_no_provider',
]);

export const planTierEnum = pgEnum('plan_tier', ['free', 'team', 'enterprise']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'past_due',
  'canceled',
  'trialing',
]);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Feature flags: scip_enabled, etc. */
    features: jsonb('features').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('organizations_slug_uidx').on(t.slug)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('users_email_uidx').on(t.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('memberships_org_user_uidx').on(t.orgId, t.userId)],
);

export const repositories = pgTable('repositories', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  remoteUrl: text('remote_url').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  visibility: repoVisibilityEnum('visibility').notNull().default('public'),
  status: repoStatusEnum('status').notNull().default('pending'),
  cloneUri: text('clone_uri'),
  lastSyncedSha: text('last_synced_sha'),
  lastError: text('last_error'),
  encryptedPat: text('encrypted_pat'),
  features: jsonb('features').$type<Record<string, unknown>>().notNull().default({}),
  /** structural (tree-sitter) | scip */
  precisionMode: text('precision_mode').notNull().default('structural'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const analysisRuns = pgTable('analysis_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  status: runStatusEnum('status').notNull().default('queued'),
  /** Semantic version of parse/link/graph pipeline that produced artifacts. */
  analyzerVersion: text('analyzer_version'),
  commitSha: text('commit_sha'),
  /** Sampled SHAs in oldest→newest order (first-parent). */
  sampleShas: jsonb('sample_shas').$type<string[]>().default([]),
  commitsDone: integer('commits_done').notNull().default(0),
  commitsTotal: integer('commits_total').notNull().default(0),
  sampleConfig: jsonb('sample_config').$type<Record<string, unknown>>().default({}),
  triggeredBy: uuid('triggered_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: jobTypeEnum('type').notNull(),
  status: jobStatusEnum('status').notNull().default('queued'),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repositories.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'cascade' }),
  progress: integer('progress').notNull().default(0),
  error: text('error'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** First-parent (and later full) commit metadata. */
export const commits = pgTable(
  'commits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    parentShas: jsonb('parent_shas').$type<string[]>().notNull().default([]),
    authoredAt: timestamp('authored_at', { withTimezone: true }),
    message: text('message'),
    /** Monotonic index along first-parent walk (0 = oldest sampled/walked). */
    topoIndex: bigint('topo_index', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('commits_repo_sha_uidx').on(t.repoId, t.sha),
    index('commits_repo_topo_idx').on(t.repoId, t.topoIndex),
    index('commits_repo_authored_idx').on(t.repoId, t.authoredAt),
  ],
);

/** Which commits were selected for an analysis run. */
export const commitSamples = pgTable(
  'commit_samples',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    topoIndex: bigint('topo_index', { mode: 'number' }).notNull(),
    reason: text('reason').notNull().default('window'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('commit_samples_run_sha_uidx').on(t.runId, t.sha),
    index('commit_samples_repo_run_idx').on(t.repoId, t.runId),
  ],
);

/** Stable entity identity across commits (UUIDv5 from repo+kind+fqn at birth). */
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    kind: entityKindEnum('kind').notNull(),
    fqn: text('fqn').notNull(),
    language: text('language'),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    renameOf: uuid('rename_of'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    firstSeenSha: text('first_seen_sha'),
    lastSeenSha: text('last_seen_sha'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('entities_repo_kind_fqn_uidx').on(t.repoId, t.kind, t.fqn),
    index('entities_repo_fqn_idx').on(t.repoId, t.fqn),
  ],
);

/** Per-commit appearance of an entity in a file. */
export const entityAppearances = pgTable(
  'entity_appearances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    path: text('path').notNull(),
    contentHash: text('content_hash'),
    blobOid: text('blob_oid'),
    loc: integer('loc'),
    startLine: integer('start_line'),
    endLine: integer('end_line'),
    analyzerVersion: text('analyzer_version').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('entity_appearances_entity_sha_path_uidx').on(
      t.entityId,
      t.commitSha,
      t.path,
    ),
    index('entity_appearances_repo_sha_idx').on(t.repoId, t.commitSha),
  ],
);

/** Rename chain links (git -M or high-confidence heuristic). */
export const entityRenames = pgTable(
  'entity_renames',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    fromSha: text('from_sha').notNull(),
    toSha: text('to_sha').notNull(),
    fromFqn: text('from_fqn').notNull(),
    toFqn: text('to_fqn').notNull(),
    fromPath: text('from_path'),
    toPath: text('to_path'),
    confidence: doublePrecision('confidence').notNull().default(1),
    source: text('source').notNull().default('git_rename'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('entity_renames_repo_sha_idx').on(t.repoId, t.toSha)],
);

/** Metadata for graph deltas stored in object storage. */
export const graphDeltas = pgTable(
  'graph_deltas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'set null' }),
    fromSha: text('from_sha').notNull(),
    toSha: text('to_sha').notNull(),
    fromTopo: bigint('from_topo', { mode: 'number' }).notNull(),
    toTopo: bigint('to_topo', { mode: 'number' }).notNull(),
    artifactUri: text('artifact_uri').notNull(),
    nodesAdded: integer('nodes_added').notNull().default(0),
    nodesRemoved: integer('nodes_removed').notNull().default(0),
    edgesAdded: integer('edges_added').notNull().default(0),
    edgesRemoved: integer('edges_removed').notNull().default(0),
    isCheckpoint: boolean('is_checkpoint').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('graph_deltas_repo_from_to_uidx').on(t.repoId, t.fromSha, t.toSha),
    index('graph_deltas_repo_topo_idx').on(t.repoId, t.toTopo),
  ],
);

/** Typed architectural timeline events. */
export const evolutionEvents = pgTable(
  'evolution_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'set null' }),
    fromSha: text('from_sha').notNull(),
    toSha: text('to_sha').notNull(),
    authoredAt: timestamp('authored_at', { withTimezone: true }),
    type: evolutionEventTypeEnum('type').notNull(),
    severity: evolutionSeverityEnum('severity').notNull().default('info'),
    title: text('title').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
    entityIds: jsonb('entity_ids').$type<string[]>().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('evolution_events_repo_type_idx').on(t.repoId, t.type),
    index('evolution_events_repo_shas_idx').on(t.repoId, t.fromSha, t.toSha),
  ],
);

export const insightEvidence = pgTable(
  'insight_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'set null' }),
    evidenceHash: text('evidence_hash').notNull(),
    bundle: jsonb('bundle').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('insight_evidence_repo_hash_uidx').on(t.repoId, t.evidenceHash),
    index('insight_evidence_repo_run_idx').on(t.repoId, t.runId),
  ],
);

export const insightCandidates = pgTable(
  'insight_candidates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'set null' }),
    candidateKey: text('candidate_key').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    score: doublePrecision('score').notNull().default(0),
    fromSha: text('from_sha').notNull(),
    toSha: text('to_sha').notNull(),
    entityIds: jsonb('entity_ids').$type<string[]>().default([]),
    signalRefs: jsonb('signal_refs').$type<string[]>().default([]),
    evidenceHash: text('evidence_hash'),
    status: text('status').notNull().default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('insight_candidates_repo_run_key_uidx').on(t.repoId, t.runId, t.candidateKey),
    index('insight_candidates_repo_run_idx').on(t.repoId, t.runId),
  ],
);

export const insights = pgTable(
  'insights',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'set null' }),
    candidateId: uuid('candidate_id').references(() => insightCandidates.id, {
      onDelete: 'set null',
    }),
    evidenceId: uuid('evidence_id').references(() => insightEvidence.id, {
      onDelete: 'set null',
    }),
    headline: text('headline').notNull(),
    narrative: text('narrative').notNull(),
    severity: insightSeverityEnum('severity').notNull(),
    category: insightCategoryEnum('category').notNull(),
    entityIds: jsonb('entity_ids').$type<string[]>().default([]),
    fromSha: text('from_sha').notNull(),
    toSha: text('to_sha').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    model: text('model'),
    provider: text('provider'),
    promptHash: text('prompt_hash'),
    confidence: doublePrecision('confidence').notNull().default(0),
    status: insightStatusEnum('status').notNull().default('published'),
    suggestedActions: jsonb('suggested_actions').$type<string[]>().default([]),
    citedSignals: jsonb('cited_signals').$type<string[]>().default([]),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    feedback: text('feedback'),
    feedbackNote: text('feedback_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('insights_repo_run_hash_uidx').on(t.repoId, t.runId, t.evidenceHash),
    index('insights_repo_created_idx').on(t.repoId, t.createdAt),
    index('insights_repo_severity_idx').on(t.repoId, t.severity),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tier: planTierEnum('tier').notNull(),
    name: text('name').notNull(),
    maxRepos: integer('max_repos').notNull().default(3),
    maxParseMinutesMonth: integer('max_parse_minutes_month').notNull().default(60),
    maxAiCallsMonth: integer('max_ai_calls_month').notNull().default(20),
    stripePriceId: text('stripe_price_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('plans_tier_uidx').on(t.tier)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    graceUntil: timestamp('grace_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('subscriptions_org_uidx').on(t.orgId)],
);

export const usageCounters = pgTable(
  'usage_counters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodYm: text('period_ym').notNull(),
    repos: integer('repos').notNull().default(0),
    parseMinutes: integer('parse_minutes').notNull().default(0),
    aiCalls: integer('ai_calls').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('usage_counters_org_period_uidx').on(t.orgId, t.periodYm)],
);

export const githubAppInstalls = pgTable(
  'github_app_installs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    accountLogin: text('account_login'),
    accountId: bigint('account_id', { mode: 'number' }),
    permissions: jsonb('permissions').$type<Record<string, unknown>>().notNull().default({}),
    suspended: boolean('suspended').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('github_app_installs_installation_uidx').on(t.installationId),
    index('github_app_installs_org_idx').on(t.orgId),
  ],
);

export const githubRepoLinks = pgTable(
  'github_repo_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    installId: uuid('install_id')
      .notNull()
      .references(() => githubAppInstalls.id, { onDelete: 'cascade' }),
    githubRepoId: bigint('github_repo_id', { mode: 'number' }).notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('github_repo_links_repo_uidx').on(t.repoId),
    uniqueIndex('github_repo_links_gh_repo_uidx').on(t.githubRepoId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type AnalysisRun = typeof analysisRuns.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Commit = typeof commits.$inferSelect;
export type CommitSample = typeof commitSamples.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type EntityAppearance = typeof entityAppearances.$inferSelect;
export type EntityRename = typeof entityRenames.$inferSelect;
export type GraphDelta = typeof graphDeltas.$inferSelect;
export type EvolutionEvent = typeof evolutionEvents.$inferSelect;
export type InsightEvidence = typeof insightEvidence.$inferSelect;
export type InsightCandidate = typeof insightCandidates.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type GithubAppInstall = typeof githubAppInstalls.$inferSelect;
export type GithubRepoLink = typeof githubRepoLinks.$inferSelect;
