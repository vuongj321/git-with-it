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
  entityId,
  EntityKind,
  JobStatus,
  RepositoryStatus,
  type EntityKindForId,
} from '@gwi/shared-types';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { db } from '../db/client';
import {
  analysisRuns,
  entities,
  entityAppearances,
  jobs,
  repositories,
} from '../db/schema';
import { writeGraphSnapshot } from '../graph/neo4j';
import { JobsService } from '../jobs/jobs.service';

const UpdateRunBody = z.object({
  status: AnalysisRunStatus,
  error: z.string().nullable().optional(),
  cloneUri: z.string().nullable().optional(),
  lastSyncedSha: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  analyzerVersion: z.string().nullable().optional(),
  jobStatus: JobStatus.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  repoStatus: RepositoryStatus.optional(),
});

const EnqueueParseBody = z.object({
  commitSha: z.string().min(7),
  cloneUri: z.string().min(1),
  analyzerVersion: z.string().min(1).default(ANALYZER_VERSION),
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

const GraphSnapshotBody = z.object({
  sha: z.string().min(7),
  analyzerVersion: z.string().min(1),
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      fqn: z.string(),
      name: z.string(),
      path: z.string().nullable().optional(),
      language: z.string().nullable().optional(),
      package: z.string().nullable().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      rel: z.string(),
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
    if (
      parsed.status === 'cloning' ||
      parsed.status === 'uploading' ||
      parsed.status === 'parsing' ||
      parsed.status === 'graph_writing'
    ) {
      runPatch.startedAt = now;
      runPatch.finishedAt = null;
    }
    if (
      parsed.status === 'ready' ||
      parsed.status === 'graph_ready' ||
      parsed.status === 'failed'
    ) {
      runPatch.finishedAt = now;
    }

    const [run] = await db
      .update(analysisRuns)
      .set(runPatch)
      .where(eq(analysisRuns.id, runId))
      .returning();

    if (!run) {
      throw new NotFoundException('Run not found');
    }

    const repoPatch: Record<string, unknown> = { updatedAt: now };
    if (parsed.cloneUri !== undefined) repoPatch.cloneUri = parsed.cloneUri;
    if (parsed.lastSyncedSha !== undefined) repoPatch.lastSyncedSha = parsed.lastSyncedSha;
    if (parsed.repoStatus) repoPatch.status = parsed.repoStatus;
    if (parsed.error !== undefined) repoPatch.lastError = parsed.error;
    if (parsed.status === 'ready' || parsed.status === 'graph_ready') {
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

  @Post('runs/:runId/enqueue-parse')
  async enqueueParse(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueParseBody.parse(body);
    const [run] = await db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.id, runId))
      .limit(1);
    if (!run) throw new NotFoundException('Run not found');
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, run.repoId))
      .limit(1);
    if (!repo) throw new NotFoundException('Repository not found');

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

  @Post('runs/:runId/enqueue-graph-write')
  async enqueueGraphWrite(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = EnqueueGraphBody.parse(body);
    const [run] = await db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.id, runId))
      .limit(1);
    if (!run) throw new NotFoundException('Run not found');
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, run.repoId))
      .limit(1);
    if (!repo) throw new NotFoundException('Repository not found');

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

  @Post('repos/:repoId/entities/upsert')
  async upsertEntities(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = UpsertEntitiesBody.parse(body);
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);
    if (!repo) throw new NotFoundException('Repository not found');

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

  @Post('repos/:repoId/graph/snapshot')
  async writeSnapshot(@Param('repoId') repoId: string, @Body() body: unknown) {
    const parsed = GraphSnapshotBody.parse(body);
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);
    if (!repo) throw new NotFoundException('Repository not found');

    await writeGraphSnapshot({
      repoId,
      sha: parsed.sha,
      analyzerVersion: parsed.analyzerVersion,
      nodes: parsed.nodes,
      edges: parsed.edges,
    });

    return { ok: true, nodes: parsed.nodes.length, edges: parsed.edges.length };
  }
}
