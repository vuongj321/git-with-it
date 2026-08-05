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
import { and, desc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { OrgMembershipGuard } from '../auth/org-membership.guard';
import { OrgIdParam } from '../auth/org.decorator';
import { db } from '../db/client';
import { analysisRuns, jobs, repositories } from '../db/schema';
import { JobsService } from '../jobs/jobs.service';

const AnalyzeBody = z.object({
  // optional override; defaults to repo.defaultBranch
  defaultBranch: z.string().min(1).optional(),
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
        triggeredBy: req.user!.userId === '00000000-0000-0000-0000-000000000000'
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
    triggeredBy: run.triggeredBy,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
