import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  integer,
  jsonb,
  pgEnum,
  index,
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
  'parsing',
  'graph_writing',
  'graph_ready',
  'failed',
]);

export const jobTypeEnum = pgEnum('job_type', ['clone', 'parse', 'graph_write']);

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

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
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

/** Stable entity identity across commits (UUIDv5 from repo+kind+fqn). */
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

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type AnalysisRun = typeof analysisRuns.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type EntityAppearance = typeof entityAppearances.$inferSelect;
