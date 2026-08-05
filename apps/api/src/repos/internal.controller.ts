import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalysisRunStatus, JobStatus, RepositoryStatus } from '@gwi/shared-types';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { db } from '../db/client';
import { analysisRuns, jobs, repositories } from '../db/schema';

const UpdateRunBody = z.object({
  status: AnalysisRunStatus,
  error: z.string().nullable().optional(),
  cloneUri: z.string().nullable().optional(),
  lastSyncedSha: z.string().nullable().optional(),
  jobStatus: JobStatus.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  repoStatus: RepositoryStatus.optional(),
});

/**
 * Internal callbacks used by the clone worker to persist progress.
 * Protected by JwtOrSessionAuth (service token or user session).
 */
@ApiTags('internal')
@ApiBearerAuth()
@Controller('v1/internal')
@UseGuards(JwtOrSessionAuthGuard)
export class InternalController {
  @Patch('runs/:runId')
  async updateRun(@Param('runId') runId: string, @Body() body: unknown) {
    const parsed = UpdateRunBody.parse(body);
    const now = new Date();

    const runPatch: Record<string, unknown> = {
      status: parsed.status,
    };
    if (parsed.error !== undefined) runPatch.error = parsed.error;
    if (parsed.status === 'cloning' || parsed.status === 'uploading') {
      runPatch.startedAt = now;
    }
    if (parsed.status === 'ready' || parsed.status === 'failed') {
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
    if (parsed.status === 'ready') repoPatch.lastError = null;

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
}
