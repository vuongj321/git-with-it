import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateRepoBodySchema, isLikelyGitRemoteUrl } from '@gwi/shared-types';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { OrgMembershipGuard } from '../auth/org-membership.guard';
import { OrgIdParam } from '../auth/org.decorator';
import { db } from '../db/client';
import { analysisRuns, entities, jobs, repositories } from '../db/schema';
import { queryGraphSlice } from '../graph/neo4j';
import { JobsService } from '../jobs/jobs.service';

const AnalyzeBody = z.object({
  defaultBranch: z.string().min(1).optional(),
});

const GraphQuery = z.object({
  sha: z.string().min(7).optional(),
  view: z.enum(['package', 'file']).default('package'),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

const EntitiesQuery = z.object({
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@ApiTags('repos')
@ApiBearerAuth()
@Controller('v1/repos')
@UseGuards(JwtOrSessionAuthGuard, OrgMembershipGuard)
export class ReposController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  async create(@Body() body: unknown, @Req() _req: Request) {
    const parsed = CreateRepoBodySchema.parse(body);
    if (!isLikelyGitRemoteUrl(parsed.remoteUrl)) {
      throw new BadRequestException('remoteUrl must be an http(s) git remote');
    }
    const [repo] = await db
      .insert(repositories)
      .values({
        orgId: parsed.orgId,
        remoteUrl: parsed.remoteUrl,
        defaultBranch: parsed.defaultBranch ?? 'main',
        visibility: parsed.visibility ?? 'public',
        status: 'pending',
      })
      .returning();
    return serializeRepo(repo!);
  }

  @Get()
  @OrgIdParam('orgId')
  async list(@Query('orgId') orgId: string) {
    if (!orgId) throw new BadRequestException('orgId query required');
    const rows = await db
      .select()
      .from(repositories)
      .where(eq(repositories.orgId, orgId))
      .orderBy(desc(repositories.createdAt));
    return rows.map(serializeRepo);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Query('orgId') orgId: string) {
    const repo = await this.requireRepo(id, orgId);
    return serializeRepo(repo);
  }

  @Get(':id/graph')
  async graph(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = GraphQuery.parse(query);
    const sha = parsed.sha ?? repo.lastSyncedSha;
    if (!sha) {
      throw new BadRequestException('sha required (repo has no lastSyncedSha)');
    }
    try {
      return await queryGraphSlice({
        repoId: repo.id,
        sha,
        view: parsed.view,
        maxNodes: parsed.limit,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`graph query failed: ${message}`);
    }
  }

  @Get(':id/entities')
  async searchEntities(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = EntitiesQuery.parse(query);
    const limit = parsed.limit;
    const rows = parsed.q
      ? await db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.repoId, repo.id),
              or(
                ilike(entities.fqn, `%${parsed.q}%`),
                ilike(entities.name, `%${parsed.q}%`),
              ),
            ),
          )
          .orderBy(entities.fqn)
          .limit(limit)
      : await db
          .select()
          .from(entities)
          .where(eq(entities.repoId, repo.id))
          .orderBy(entities.fqn)
          .limit(limit);

    return rows.map((e) => ({
      id: e.id,
      repoId: e.repoId,
      kind: e.kind,
      fqn: e.fqn,
      name: e.name,
      language: e.language,
      status: e.status,
    }));
  }

  @Post(':id/analyze')
  async analyze(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = AnalyzeBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const repo = await this.requireRepo(id, orgId);

    const [run] = await db
      .insert(analysisRuns)
      .values({
        repoId: repo.id,
        status: 'queued',
        triggeredBy:
          req.user!.userId === '00000000-0000-0000-0000-000000000000'
            ? null
            : req.user!.userId,
      })
      .returning();

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'clone',
        status: 'queued',
        orgId: repo.orgId,
        repoId: repo.id,
        runId: run!.id,
        progress: 0,
        payload: { remoteUrl: repo.remoteUrl },
      })
      .returning();

    await db
      .update(repositories)
      .set({ status: 'cloning', lastError: null, updatedAt: new Date() })
      .where(eq(repositories.id, repo.id));

    await this.jobsService.enqueueClone({
      jobId: job!.id,
      runId: run!.id,
      repoId: repo.id,
      orgId: repo.orgId,
      remoteUrl: repo.remoteUrl,
      defaultBranch: parsed.data.defaultBranch ?? repo.defaultBranch,
      encryptedPat: repo.encryptedPat ?? undefined,
    });

    return {
      run: serializeRun(run!),
      job: { id: job!.id, status: job!.status },
    };
  }

  @Get(':id/runs/:runId')
  async getRun(
    @Param('id') id: string,
    @Param('runId') runId: string,
    @Query('orgId') orgId: string,
  ) {
    await this.requireRepo(id, orgId);
    const rows = await db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.repoId, id)))
      .limit(1);
    const run = rows[0];
    if (!run) throw new NotFoundException('Run not found');
    return serializeRun(run);
  }

  private async requireRepo(id: string, orgId: string) {
    if (!orgId) throw new BadRequestException('orgId query required');
    const rows = await db
      .select()
      .from(repositories)
      .where(and(eq(repositories.id, id), eq(repositories.orgId, orgId)))
      .limit(1);
    const repo = rows[0];
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }
}

function serializeRepo(repo: typeof repositories.$inferSelect) {
  return {
    id: repo.id,
    orgId: repo.orgId,
    remoteUrl: repo.remoteUrl,
    defaultBranch: repo.defaultBranch,
    visibility: repo.visibility,
    status: repo.status,
    cloneUri: repo.cloneUri,
    lastSyncedSha: repo.lastSyncedSha,
    lastError: repo.lastError,
    createdAt: repo.createdAt.toISOString(),
    updatedAt: repo.updatedAt.toISOString(),
  };
}

function serializeRun(run: typeof analysisRuns.$inferSelect) {
  return {
    id: run.id,
    repoId: run.repoId,
    status: run.status,
    analyzerVersion: run.analyzerVersion ?? null,
    commitSha: run.commitSha ?? null,
    triggeredBy: run.triggeredBy,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
