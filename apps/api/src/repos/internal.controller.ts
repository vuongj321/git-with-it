import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ANALYZER_VERSION,
  AnalysisRunStatus,
  type EvidenceBundle,
  entityId,
  EntityKind,
  EvolutionEventType,
  EvolutionSeverity,
  InsightCategory,
  InsightSeverity,
  InsightStatus,
  JobStatus,
  RepositoryStatus,
  SampleConfigSchema,
  type EntityKindForId,
} from '@gwi/shared-types';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { db } from '../db/client';
import {
  analysisRuns,
  commitSamples,
  commits,
  entities,
  entityAppearances,
  entityRenames,
  evolutionEvents,
  graphDeltas,
  insightCandidates,
  insightEvidence,
  insights,
  jobs,
  repositories,
} from '../db/schema';
import {
  applyTemporalEdgeDelta,
  upsertTemporalNodes,
  writeTemporalSnapshot,
} from '../graph/neo4j';
import { JobsService } from '../jobs/jobs.service';
import { writeMetricRows } from '../metrics/clickhouse';
import { invalidateRepoCaches } from '../cache/redis-cache';
import { loadGraphDiff, loadGraphSnapshot } from '../storage/s3';
import type { MetricRow } from '@gwi/shared-types';

const UpdateRunBody = z.object({
  status: AnalysisRunStatus,
  error: z.string().nullable().optional(),
  cloneUri: z.string().nullable().optional(),
  lastSyncedSha: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  analyzerVersion: z.string().nullable().optional(),
  sampleShas: z.array(z.string()).optional(),
  commitsDone: z.number().int().optional(),
  commitsTotal: z.number().int().optional(),
  sampleConfig: z.record(z.unknown()).optional(),
  jobStatus: JobStatus.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  repoStatus: RepositoryStatus.optional(),
});

const EnqueueParseBody = z.object({
  commitSha: z.string().min(7),
  cloneUri: z.string().min(1),
  analyzerVersion: z.string().min(1).default(ANALYZER_VERSION),
});

const EnqueueEnumerateBody = z.object({
  tipSha: z.string().min(7),
  cloneUri: z.string().min(1),
  analyzerVersion: z.string().min(1).default(ANALYZER_VERSION),
  sampleConfig: SampleConfigSchema.partial().optional(),
});

const EnqueueParseCommitsBody = z.object({
  cloneUri: z.string().min(1),
  analyzerVersion: z.string().min(1).default(ANALYZER_VERSION),
  sampleShas: z.array(z.string().min(7)).min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});

const EnqueueEvolveBody = z.object({
  sampleShas: z.array(z.string().min(7)).min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});

const EnqueueAiBody = z.object({
  sampleShas: z.array(z.string().min(7)).min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});

const EnqueueMetricsBody = z.object({
  sampleShas: z.array(z.string().min(7)).min(1),
  sampleConfig: SampleConfigSchema.partial().optional(),
});

const MetricsWriteBody = z.object({
  rows: z.array(
    z.object({
      repoId: z.string().uuid(),
      commitSha: z.string().min(7),
      topoIndex: z.number().int().min(0),
      authoredAt: z.string().nullable().optional(),
      entityId: z.string().uuid(),
      entityKind: z.string().min(1),
      metric: z.string().min(1),
      value: z.number(),
    }),
  ),
});

const EnqueueGraphBody = z.object({
  commitSha: z.string().min(7),
  analyzerVersion: z.string().min(1).default(ANALYZER_VERSION),
});

const UpsertEntitiesBody = z.object({
  commitSha: z.string().min(7),
  analyzerVersion: z.string().min(1),
  entities: z.array(
    z.object({
      kind: EntityKind,
      fqn: z.string().min(1),
      name: z.string().min(1),
      language: z.string().nullable().optional(),
      path: z.string().min(1),
      loc: z.number().int().nullable().optional(),
      startLine: z.number().int().nullable().optional(),
      endLine: z.number().int().nullable().optional(),
      blobOid: z.string().nullable().optional(),
      contentHash: z.string().nullable().optional(),
      export: z.boolean().optional(),
    }),
  ),
});

const GraphNodeBody = z.object({
  id: z.string(),
  kind: z.string(),
  fqn: z.string(),
  name: z.string(),
  path: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  package: z.string().nullable().optional(),
});

const GraphEdgeBody = z.object({
  from: z.string(),
  to: z.string(),
  rel: z.string(),
});

/** Prefer MinIO artifactUri; inline nodes/edges kept for small fixtures / backwards compat. */
const GraphSnapshotBody = z
  .object({
    sha: z.string().min(7),
    analyzerVersion: z.string().min(1),
    artifactUri: z.string().min(1).optional(),
    nodes: z.array(GraphNodeBody).optional(),
    edges: z.array(GraphEdgeBody).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.artifactUri && (!val.nodes || !val.edges)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'artifactUri or nodes+edges required',
      });
    }
  });

const TemporalSnapshotBody = GraphSnapshotBody.and(
  z.object({
    topoIndex: z.number().int().min(0),
    replaceRepo: z.boolean().optional().default(false),
  }),
);

const TemporalBootstrapBody = TemporalSnapshotBody;

const GraphDeltaBody = z.object({
  runId: z.string().uuid().optional(),
  fromSha: z.string().min(7),
  toSha: z.string().min(7),
  fromTopo: z.number().int(),
  toTopo: z.number().int(),
  /** Compressed GraphDiff in MinIO (.json.gz / .json.zst). */
  artifactUri: z.string().min(1),
  /** Optional snapshot key; defaults to repos/{repoId}/graphs/{toSha}.json */
  snapshotUri: z.string().min(1).optional(),
  edgesAdded: z.array(GraphEdgeBody).optional(),
  edgesRemoved: z.array(GraphEdgeBody).optional(),
  nodes: z.array(GraphNodeBody).optional(),
  analyzerVersion: z.string().min(1),
  nodesAdded: z.number().int().default(0),
  nodesRemoved: z.number().int().default(0),
  edgesAddedCount: z.number().int().default(0),
  edgesRemovedCount: z.number().int().default(0),
  renames: z
    .array(
      z.object({
        fromPath: z.string(),
        toPath: z.string(),
        confidence: z.number().optional(),
        source: z.string().optional(),
      }),
    )
    .optional(),
});

const CheckpointBody = z.object({
  runId: z.string().uuid().optional(),
  sha: z.string().min(7),
  topoIndex: z.number().int(),
  artifactUri: z.string().min(1),
});

const CommitsUpsertBody = z.object({
  runId: z.string().uuid(),
  commits: z.array(
    z.object({
      sha: z.string().min(7),
      parentShas: z.array(z.string()),
      authoredAt: z.string().nullable(),
      message: z.string().nullable().optional(),
    }),
  ),
  samples: z.array(
    z.object({
      sha: z.string().min(7),
      topoIndex: z.number().int(),
      reason: z.string(),
    }),
  ),
  sampleConfig: z.record(z.unknown()).optional(),
});

const RenamesBody = z.object({
  fromSha: z.string().min(7).nullable(),
  toSha: z.string().min(7),
  renames: z.array(
    z.object({
      fromPath: z.string(),
      toPath: z.string(),
      confidence: z.number().default(1),
      source: z.string().default('git_rename'),
    }),
  ),
});

const EvolutionEventsBody = z.object({
  runId: z.string().uuid().optional(),
  fromSha: z.string().min(7),
  toSha: z.string().min(7),
  authoredAt: z.string().nullable().optional(),
  events: z.array(
    z.object({
      type: EvolutionEventType,
      severity: EvolutionSeverity,
      title: z.string(),
      payload: z.record(z.unknown()).default({}),
      entityIds: z.array(z.string()).default([]),
    }),
  ),
});

const InsightBatchUpsertBody = z.object({
  runId: z.string().uuid(),
  analyzerVersion: z.string().nullable().optional(),
  providerState: z.enum(['published', 'skipped_no_provider']).default('published'),
  evidence: z.array(
    z.object({
      evidenceHash: z.string().min(1),
      bundle: z.record(z.unknown()),
    }),
  ),
  candidates: z.array(
    z.object({
      candidateKey: z.string().min(1),
      type: z.string().min(1),
      title: z.string().min(1),
      score: z.number(),
      fromSha: z.string().min(7),
      toSha: z.string().min(7),
      entityIds: z.array(z.string().uuid()).default([]),
      signalRefs: z.array(z.string()).default([]),
      evidenceHash: z.string().min(1).nullable().optional(),
      status: z.string().default('queued'),
    }),
  ),
  insights: z.array(
    z.object({
      candidateKey: z.string().min(1),
      headline: z.string().min(1),
      narrative: z.string().min(1),
      severity: InsightSeverity,
      category: InsightCategory,
      entityIds: z.array(z.string().uuid()).default([]),
      fromSha: z.string().min(7),
      toSha: z.string().min(7),
      evidenceHash: z.string().min(1),
      model: z.string().nullable().optional(),
      provider: z.string().nullable().optional(),
      promptHash: z.string().nullable().optional(),
      confidence: z.number(),
      status: InsightStatus,
      suggestedActions: z.array(z.string()).default([]),
      citedSignals: z.array(z.string()).default([]),
    }),
  ),
});

@ApiTags('internal')
@ApiBearerAuth()
@Controller('v1/internal')
@UseGuards(JwtOrSessionAuthGuard)
export class InternalController {
  constructor(private readonly jobsService: JobsService) {}

  @Patch('runs/:runId')
  async updateRun(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = UpdateRunBody.parse(body);
    const now = new Date();

    const runPatch: Record<string, unknown> = {
      status: parsed.status,
    };
    if (parsed.error !== undefined) runPatch.error = parsed.error;
    if (parsed.commitSha !== undefined) runPatch.commitSha = parsed.commitSha;
    if (parsed.analyzerVersion !== undefined) {
      runPatch.analyzerVersion = parsed.analyzerVersion;
    }
    if (parsed.sampleShas !== undefined) runPatch.sampleShas = parsed.sampleShas;
    if (parsed.commitsDone !== undefined) runPatch.commitsDone = parsed.commitsDone;
    if (parsed.commitsTotal !== undefined) runPatch.commitsTotal = parsed.commitsTotal;
    if (parsed.sampleConfig !== undefined) runPatch.sampleConfig = parsed.sampleConfig;
    if (
      parsed.status === 'cloning' ||
      parsed.status === 'uploading' ||
      parsed.status === 'enumerating' ||
      parsed.status === 'parsing' ||
      parsed.status === 'graph_writing' ||
      parsed.status === 'metrics_writing' ||
      parsed.status === 'evolving' ||
      parsed.status === 'ai_generating'
    ) {
      runPatch.startedAt = now;
      runPatch.finishedAt = null;
    }
    if (
      parsed.status === 'ready' ||
      parsed.status === 'graph_ready' ||
      parsed.status === 'evolution_ready' ||
      parsed.status === 'failed'
    ) {
      if (parsed.status === 'evolution_ready' || parsed.status === 'failed') {
        runPatch.finishedAt = now;
      }
    }

    const [run] = await db
      .update(analysisRuns)
      .set(runPatch)
      .where(eq(analysisRuns.id, runId))
      .returning();

    if (!run) {
      throw new NotFoundException('Run not found');
    }

    if (parsed.status === 'evolution_ready' || parsed.status === 'failed') {
      await invalidateRepoCaches(run.repoId);
    }

    const repoPatch: Record<string, unknown> = { updatedAt: now };
    if (parsed.cloneUri !== undefined) repoPatch.cloneUri = parsed.cloneUri;
    if (parsed.lastSyncedSha !== undefined) repoPatch.lastSyncedSha = parsed.lastSyncedSha;
    if (parsed.repoStatus) repoPatch.status = parsed.repoStatus;
    if (parsed.error !== undefined) repoPatch.lastError = parsed.error;
    if (
      parsed.status === 'ready' ||
      parsed.status === 'graph_ready' ||
      parsed.status === 'evolution_ready'
    ) {
      repoPatch.lastError = null;
    }

    await db.update(repositories).set(repoPatch).where(eq(repositories.id, run.repoId));

    if (parsed.jobStatus || parsed.progress !== undefined) {
      const jobPatch: Record<string, unknown> = { updatedAt: now };
      if (parsed.jobStatus) jobPatch.status = parsed.jobStatus;
      if (parsed.progress !== undefined) jobPatch.progress = parsed.progress;
      if (parsed.error !== undefined) jobPatch.error = parsed.error;
      await db.update(jobs).set(jobPatch).where(eq(jobs.runId, runId));
    }

    return { ok: true };
  }

  @Post('runs/:runId/enqueue-enumerate')
  async enqueueEnumerate(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueEnumerateBody.parse(body);
    const { run, repo } = await this.requireRunRepo(runId);

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'enumerate_sample',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run.id,
        progress: 0,
        payload: { tipSha: parsed.tipSha, cloneUri: parsed.cloneUri },
      })
      .returning();

    await db
      .update(analysisRuns)
      .set({
        status: 'enumerating',
        commitSha: parsed.tipSha,
        analyzerVersion: parsed.analyzerVersion,
        finishedAt: null,
      })
      .where(eq(analysisRuns.id, runId));

    await this.jobsService.enqueueEnumerate({
      jobId: job!.id,
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      tipSha: parsed.tipSha,
      cloneUri: parsed.cloneUri,
      analyzerVersion: parsed.analyzerVersion,
      sampleConfig: parsed.sampleConfig,
    });

    return { ok: true, jobId: job!.id };
  }

  @Post('runs/:runId/enqueue-parse')
  async enqueueParse(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueParseBody.parse(body);
    const { run, repo } = await this.requireRunRepo(runId);

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'parse',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run.id,
        progress: 0,
        payload: { commitSha: parsed.commitSha, cloneUri: parsed.cloneUri },
      })
      .returning();

    await db
      .update(analysisRuns)
      .set({
        status: 'parsing',
        commitSha: parsed.commitSha,
        analyzerVersion: parsed.analyzerVersion,
        finishedAt: null,
      })
      .where(eq(analysisRuns.id, runId));

    await this.jobsService.enqueueParse({
      jobId: job!.id,
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      commitSha: parsed.commitSha,
      cloneUri: parsed.cloneUri,
      analyzerVersion: parsed.analyzerVersion,
    });

    return { ok: true, jobId: job!.id };
  }

  @Post('runs/:runId/enqueue-parse-commits')
  async enqueueParseCommits(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueParseCommitsBody.parse(body);
    const { run, repo } = await this.requireRunRepo(runId);

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'parse_commit',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run.id,
        progress: 0,
        payload: { sampleShas: parsed.sampleShas },
      })
      .returning();

    await db
      .update(analysisRuns)
      .set({
        status: 'parsing',
        sampleShas: parsed.sampleShas,
        commitsTotal: parsed.sampleShas.length,
        commitsDone: 0,
        finishedAt: null,
      })
      .where(eq(analysisRuns.id, runId));

    await this.jobsService.enqueueParseCommit({
      jobId: job!.id,
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      cloneUri: parsed.cloneUri,
      analyzerVersion: parsed.analyzerVersion,
      sampleShas: parsed.sampleShas,
      sampleConfig: parsed.sampleConfig,
    });

    return { ok: true, jobId: job!.id };
  }

  @Post('runs/:runId/enqueue-evolve')
  async enqueueEvolve(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueEvolveBody.parse(body);
    const { run, repo } = await this.requireRunRepo(runId);

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'evolve',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run.id,
        progress: 0,
        payload: { sampleShas: parsed.sampleShas },
      })
      .returning();

    await this.jobsService.enqueueEvolve({
      jobId: job!.id,
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      sampleShas: parsed.sampleShas,
      sampleConfig: parsed.sampleConfig,
    });

    return { ok: true, jobId: job!.id };
  }

  @Post('runs/:runId/enqueue-ai')
  async enqueueAi(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueAiBody.parse(body);
    const { run, repo } = await this.requireRunRepo(runId);

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'ai',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run.id,
        progress: 0,
        payload: { sampleShas: parsed.sampleShas },
      })
      .returning();

    await db
      .update(analysisRuns)
      .set({ status: 'ai_generating', finishedAt: null })
      .where(eq(analysisRuns.id, runId));

    await this.jobsService.enqueueAi({
      jobId: job!.id,
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      sampleShas: parsed.sampleShas,
      sampleConfig: parsed.sampleConfig,
    });

    return { ok: true, jobId: job!.id };
  }

  @Post('runs/:runId/enqueue-metrics')
  async enqueueMetrics(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueMetricsBody.parse(body);
    const { run, repo } = await this.requireRunRepo(runId);

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'metrics_write',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run.id,
        progress: 0,
        payload: { sampleShas: parsed.sampleShas },
      })
      .returning();

    await db
      .update(analysisRuns)
      .set({ status: 'metrics_writing', finishedAt: null })
      .where(eq(analysisRuns.id, runId));

    await this.jobsService.enqueueMetricsWrite({
      jobId: job!.id,
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      sampleShas: parsed.sampleShas,
      sampleConfig: parsed.sampleConfig,
    });

    return { ok: true, jobId: job!.id };
  }

  @Post('repos/:repoId/metrics/write')
  async writeMetrics(@Param('repoId') repoId: string, @Body() body: unknown) {
    await this.requireRepo(repoId);
    const parsed = MetricsWriteBody.parse(body);
    const rows = parsed.rows.map(
      (r): MetricRow => ({
        repoId: r.repoId,
        commitSha: r.commitSha,
        topoIndex: r.topoIndex,
        authoredAt: r.authoredAt ?? null,
        entityId: r.entityId,
        entityKind: r.entityKind,
        metric: r.metric as MetricRow['metric'],
        value: r.value,
      }),
    );
    const result = await writeMetricRows(rows);
    return { ok: true, ...result };
  }

  @Post('runs/:runId/enqueue-graph-write')
  async enqueueGraphWrite(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueGraphBody.parse(body);
    const { run, repo } = await this.requireRunRepo(runId);

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'graph_write',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run.id,
        progress: 0,
        payload: { commitSha: parsed.commitSha },
      })
      .returning();

    await db
      .update(analysisRuns)
      .set({ status: 'graph_writing', finishedAt: null })
      .where(eq(analysisRuns.id, runId));

    await this.jobsService.enqueueGraphWrite({
      jobId: job!.id,
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      commitSha: parsed.commitSha,
      analyzerVersion: parsed.analyzerVersion,
    });

    return { ok: true, jobId: job!.id };
  }

  @Post('repos/:repoId/commits/upsert')
  async upsertCommits(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = CommitsUpsertBody.parse(body);
    await this.requireRepo(repoId);

    // Map sha → topo from samples for persistence on commits
    const topoBySha = new Map(parsed.samples.map((s) => [s.sha, s.topoIndex]));

    for (const c of parsed.commits) {
      await db
        .insert(commits)
        .values({
          repoId,
          sha: c.sha,
          parentShas: c.parentShas,
          authoredAt: c.authoredAt ? new Date(c.authoredAt) : null,
          message: c.message ?? null,
          topoIndex: topoBySha.get(c.sha) ?? null,
        })
        .onConflictDoUpdate({
          target: [commits.repoId, commits.sha],
          set: {
            parentShas: c.parentShas,
            authoredAt: c.authoredAt ? new Date(c.authoredAt) : null,
            message: c.message ?? null,
            topoIndex: topoBySha.get(c.sha) ?? null,
          },
        });
    }

    for (const s of parsed.samples) {
      await db
        .insert(commitSamples)
        .values({
          repoId,
          runId: parsed.runId,
          sha: s.sha,
          topoIndex: s.topoIndex,
          reason: s.reason,
        })
        .onConflictDoUpdate({
          target: [commitSamples.runId, commitSamples.sha],
          set: { topoIndex: s.topoIndex, reason: s.reason },
        });
    }

    await db
      .update(analysisRuns)
      .set({
        sampleShas: parsed.samples
          .slice()
          .sort((a, b) => a.topoIndex - b.topoIndex)
          .map((s) => s.sha),
        commitsTotal: parsed.samples.length,
        sampleConfig: parsed.sampleConfig ?? {},
      })
      .where(eq(analysisRuns.id, parsed.runId));

    return { ok: true, commits: parsed.commits.length, samples: parsed.samples.length };
  }

  @Post('repos/:repoId/entities/upsert')
  async upsertEntities(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = UpsertEntitiesBody.parse(body);
    await this.requireRepo(repoId);

    let upserted = 0;
    for (const e of parsed.entities) {
      const id = entityId(repoId, e.kind as EntityKindForId, e.fqn);
      await db
        .insert(entities)
        .values({
          id,
          repoId,
          kind: e.kind,
          fqn: e.fqn,
          name: e.name,
          language: e.language ?? null,
          status: 'active',
          firstSeenSha: parsed.commitSha,
          lastSeenSha: parsed.commitSha,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [entities.repoId, entities.kind, entities.fqn],
          set: {
            name: e.name,
            language: e.language ?? null,
            lastSeenSha: parsed.commitSha,
            updatedAt: new Date(),
            status: 'active',
          },
        });

      await db
        .insert(entityAppearances)
        .values({
          entityId: id,
          repoId,
          commitSha: parsed.commitSha,
          path: e.path,
          contentHash: e.contentHash ?? null,
          blobOid: e.blobOid ?? null,
          loc: e.loc ?? null,
          startLine: e.startLine ?? null,
          endLine: e.endLine ?? null,
          analyzerVersion: parsed.analyzerVersion,
          meta: { export: e.export ?? false },
        })
        .onConflictDoUpdate({
          target: [
            entityAppearances.entityId,
            entityAppearances.commitSha,
            entityAppearances.path,
          ],
          set: {
            contentHash: e.contentHash ?? null,
            blobOid: e.blobOid ?? null,
            loc: e.loc ?? null,
            startLine: e.startLine ?? null,
            endLine: e.endLine ?? null,
            analyzerVersion: parsed.analyzerVersion,
            meta: { export: e.export ?? false },
          },
        });
      upserted += 1;
    }

    return { ok: true, upserted };
  }

  @Post('repos/:repoId/entities/renames')
  async recordRenames(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = RenamesBody.parse(body);
    await this.requireRepo(repoId);

    for (const r of parsed.renames) {
      const fromFqn = r.fromPath;
      const toFqn = r.toPath;
      const fromId = entityId(repoId, 'file', fromFqn);
      const [existing] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, fromId))
        .limit(1);
      const entityRef = existing?.id ?? entityId(repoId, 'file', toFqn);
      if (existing) {
        await db
          .update(entities)
          .set({
            renameOf: existing.renameOf ?? existing.id,
            metadata: { ...(existing.metadata ?? {}), priorFqn: fromFqn, currentPath: r.toPath },
            lastSeenSha: parsed.toSha,
            updatedAt: new Date(),
          })
          .where(eq(entities.id, existing.id));
      }
      await db.insert(entityRenames).values({
        repoId,
        entityId: entityRef,
        fromSha: parsed.fromSha ?? parsed.toSha,
        toSha: parsed.toSha,
        fromFqn,
        toFqn,
        fromPath: r.fromPath,
        toPath: r.toPath,
        confidence: r.confidence,
        source: r.source,
      });
    }

    return { ok: true, count: parsed.renames.length };
  }

  @Post('repos/:repoId/graph/snapshot')
  async writeSnapshot(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = GraphSnapshotBody.parse(body);
    await this.requireRepo(repoId);
    const graph = await this.resolveGraphPayload(repoId, parsed);

    await writeTemporalSnapshot({
      repoId,
      sha: parsed.sha,
      topoIndex: 0,
      analyzerVersion: parsed.analyzerVersion,
      nodes: graph.nodes,
      edges: graph.edges,
      replaceRepo: true,
    });

    return { ok: true, nodes: graph.nodes.length, edges: graph.edges.length };
  }

  @Post('repos/:repoId/graph/temporal-snapshot')
  async temporalSnapshot(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = TemporalSnapshotBody.parse(body);
    await this.requireRepo(repoId);
    const graph = await this.resolveGraphPayload(repoId, parsed);
    await writeTemporalSnapshot({
      repoId,
      sha: parsed.sha,
      topoIndex: parsed.topoIndex,
      analyzerVersion: parsed.analyzerVersion,
      nodes: graph.nodes,
      edges: graph.edges,
      replaceRepo: parsed.replaceRepo,
    });
    return { ok: true, nodes: graph.nodes.length, edges: graph.edges.length };
  }

  @Post('repos/:repoId/graph/temporal-bootstrap')
  async temporalBootstrap(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = TemporalBootstrapBody.parse(body);
    await this.requireRepo(repoId);
    const graph = await this.resolveGraphPayload(repoId, parsed);
    await upsertTemporalNodes({
      repoId,
      analyzerVersion: parsed.analyzerVersion,
      nodes: graph.nodes,
    });
    // Only add edges that aren't already open — MVP: apply as added at this topo
    await applyTemporalEdgeDelta({
      repoId,
      sha: parsed.sha,
      topoIndex: parsed.topoIndex,
      analyzerVersion: parsed.analyzerVersion,
      edgesAdded: graph.edges,
      edgesRemoved: [],
    });
    return { ok: true, nodes: graph.nodes.length, edges: graph.edges.length };
  }

  @Post('repos/:repoId/graph/delta')
  async graphDelta(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = GraphDeltaBody.parse(body);
    await this.requireRepo(repoId);

    let nodes = parsed.nodes ?? [];
    let edgesAdded = parsed.edgesAdded ?? [];
    let edgesRemoved = parsed.edgesRemoved ?? [];

    if (nodes.length === 0) {
      const snap = await loadGraphSnapshot(repoId, parsed.toSha, parsed.snapshotUri);
      nodes = snap.nodes;
    }
    if (edgesAdded.length === 0 && edgesRemoved.length === 0) {
      const diff = await loadGraphDiff(parsed.artifactUri);
      edgesAdded = diff.edgesAdded;
      edgesRemoved = diff.edgesRemoved;
    }

    await upsertTemporalNodes({
      repoId,
      analyzerVersion: parsed.analyzerVersion,
      nodes,
    });
    await applyTemporalEdgeDelta({
      repoId,
      sha: parsed.toSha,
      topoIndex: parsed.toTopo,
      analyzerVersion: parsed.analyzerVersion,
      edgesAdded,
      edgesRemoved,
    });

    await db
      .insert(graphDeltas)
      .values({
        repoId,
        runId: parsed.runId ?? null,
        fromSha: parsed.fromSha,
        toSha: parsed.toSha,
        fromTopo: parsed.fromTopo,
        toTopo: parsed.toTopo,
        artifactUri: parsed.artifactUri,
        nodesAdded: parsed.nodesAdded,
        nodesRemoved: parsed.nodesRemoved,
        edgesAdded: parsed.edgesAddedCount || edgesAdded.length,
        edgesRemoved: parsed.edgesRemovedCount || edgesRemoved.length,
        isCheckpoint: false,
      })
      .onConflictDoUpdate({
        target: [graphDeltas.repoId, graphDeltas.fromSha, graphDeltas.toSha],
        set: {
          artifactUri: parsed.artifactUri,
          nodesAdded: parsed.nodesAdded,
          nodesRemoved: parsed.nodesRemoved,
          edgesAdded: parsed.edgesAddedCount || edgesAdded.length,
          edgesRemoved: parsed.edgesRemovedCount || edgesRemoved.length,
        },
      });

    return { ok: true };
  }

  @Post('repos/:repoId/graph/checkpoint')
  async checkpoint(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = CheckpointBody.parse(body);
    await this.requireRepo(repoId);
    await db.insert(graphDeltas).values({
      repoId,
      runId: parsed.runId ?? null,
      fromSha: parsed.sha,
      toSha: parsed.sha,
      fromTopo: parsed.topoIndex,
      toTopo: parsed.topoIndex,
      artifactUri: parsed.artifactUri,
      isCheckpoint: true,
    });
    return { ok: true };
  }

  @Post('repos/:repoId/evolution-events')
  async insertEvents(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = EvolutionEventsBody.parse(body);
    await this.requireRepo(repoId);

    let authoredAt: Date | null = parsed.authoredAt
      ? new Date(parsed.authoredAt)
      : null;
    if (!authoredAt) {
      const [c] = await db
        .select()
        .from(commits)
        .where(eq(commits.sha, parsed.toSha))
        .limit(1);
      authoredAt = c?.authoredAt ?? null;
    }

    for (const e of parsed.events) {
      await db.insert(evolutionEvents).values({
        repoId,
        runId: parsed.runId ?? null,
        fromSha: parsed.fromSha,
        toSha: parsed.toSha,
        authoredAt,
        type: e.type,
        severity: e.severity,
        title: e.title,
        payload: e.payload,
        entityIds: e.entityIds,
      });
    }

    return { ok: true, count: parsed.events.length };
  }

  @Post('repos/:repoId/insights/batch-upsert')
  async batchUpsertInsights(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = InsightBatchUpsertBody.parse(body);
    await this.requireRepo(repoId);

    const evidenceIds = new Map<string, string>();
    for (const item of parsed.evidence) {
      const bundle = item.bundle as EvidenceBundle;
      const [row] = await db
        .insert(insightEvidence)
        .values({
          repoId,
          runId: parsed.runId,
          evidenceHash: item.evidenceHash,
          bundle,
        })
        .onConflictDoUpdate({
          target: [insightEvidence.repoId, insightEvidence.evidenceHash],
          set: { runId: parsed.runId, bundle, createdAt: new Date() },
        })
        .returning();
      evidenceIds.set(item.evidenceHash, row!.id);
    }

    const candidateIds = new Map<string, string>();
    for (const item of parsed.candidates) {
      const [row] = await db
        .insert(insightCandidates)
        .values({
          repoId,
          runId: parsed.runId,
          candidateKey: item.candidateKey,
          type: item.type,
          title: item.title,
          score: item.score,
          fromSha: item.fromSha,
          toSha: item.toSha,
          entityIds: item.entityIds,
          signalRefs: item.signalRefs,
          evidenceHash: item.evidenceHash ?? null,
          status: item.status,
        })
        .onConflictDoUpdate({
          target: [insightCandidates.repoId, insightCandidates.runId, insightCandidates.candidateKey],
          set: {
            type: item.type,
            title: item.title,
            score: item.score,
            fromSha: item.fromSha,
            toSha: item.toSha,
            entityIds: item.entityIds,
            signalRefs: item.signalRefs,
            evidenceHash: item.evidenceHash ?? null,
            status: item.status,
          },
        })
        .returning();
      candidateIds.set(item.candidateKey, row!.id);
    }

    for (const item of parsed.insights) {
      const [row] = await db
        .insert(insights)
        .values({
          repoId,
          runId: parsed.runId,
          candidateId: candidateIds.get(item.candidateKey) ?? null,
          evidenceId: evidenceIds.get(item.evidenceHash) ?? null,
          headline: item.headline,
          narrative: item.narrative,
          severity: item.severity,
          category: item.category,
          entityIds: item.entityIds,
          fromSha: item.fromSha,
          toSha: item.toSha,
          evidenceHash: item.evidenceHash,
          model: item.model ?? null,
          provider: item.provider ?? null,
          promptHash: item.promptHash ?? null,
          confidence: item.confidence,
          status: item.status,
          suggestedActions: item.suggestedActions,
          citedSignals: item.citedSignals,
        })
        .onConflictDoUpdate({
          target: [insights.repoId, insights.runId, insights.evidenceHash],
          set: {
            candidateId: candidateIds.get(item.candidateKey) ?? null,
            evidenceId: evidenceIds.get(item.evidenceHash) ?? null,
            headline: item.headline,
            narrative: item.narrative,
            severity: item.severity,
            category: item.category,
            entityIds: item.entityIds,
            fromSha: item.fromSha,
            toSha: item.toSha,
            model: item.model ?? null,
            provider: item.provider ?? null,
            promptHash: item.promptHash ?? null,
            confidence: item.confidence,
            status: item.status,
            suggestedActions: item.suggestedActions,
            citedSignals: item.citedSignals,
          },
        })
        .returning();
      console.info('insight.created', { repoId, runId: parsed.runId, insightId: row!.id });
    }

    return {
      ok: true,
      evidence: parsed.evidence.length,
      candidates: parsed.candidates.length,
      insights: parsed.insights.length,
      providerState: parsed.providerState,
    };
  }

  private async resolveGraphPayload(
    repoId: string,
    parsed: {
      sha: string;
      artifactUri?: string;
      nodes?: Array<{
        id: string;
        kind: string;
        fqn: string;
        name: string;
        path?: string | null;
        language?: string | null;
        package?: string | null;
      }>;
      edges?: Array<{ from: string; to: string; rel: string }>;
    },
  ) {
    if (parsed.artifactUri || !parsed.nodes || !parsed.edges) {
      const snap = await loadGraphSnapshot(repoId, parsed.sha, parsed.artifactUri);
      return { nodes: snap.nodes, edges: snap.edges };
    }
    return { nodes: parsed.nodes, edges: parsed.edges };
  }

  private async requireRunRepo(runId: string) {
    const [run] = await db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.id, runId))
      .limit(1);
    if (!run) throw new NotFoundException('Run not found');
    const repo = await this.requireRepo(run.repoId);
    return { run, repo };
  }

  private async requireRepo(repoId: string) {
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }
}
