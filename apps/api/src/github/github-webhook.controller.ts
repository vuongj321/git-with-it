import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../config/env';
import { db } from '../db/client';
import {
  analysisRuns,
  githubAppInstalls,
  githubRepoLinks,
  jobs,
  repositories,
} from '../db/schema';
import { JobsService } from '../jobs/jobs.service';

/**
 * Thin GitHub App webhook surface (Phase 5).
 * Verifies `X-Hub-Signature-256` when GITHUB_WEBHOOK_SECRET is set.
 */
@Controller('v1/github')
export class GithubWebhookController {
  private readonly log = new Logger(GithubWebhookController.name);

  constructor(private readonly jobsService: JobsService) {}

  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.verifySignature(req, signature);

    if (event === 'installation' || event === 'installation_repositories') {
      this.log.log(`github event=${event} action=${String(body.action)}`);
      return { ok: true };
    }

    if (event === 'push') {
      return this.handlePush(body);
    }

    return { ok: true, ignored: event ?? 'unknown' };
  }

  private verifySignature(req: RawBodyRequest<Request>, signature?: string) {
    const secret = env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      if (env.NODE_ENV === 'production') {
        throw new UnauthorizedException('GITHUB_WEBHOOK_SECRET required');
      }
      return;
    }
    const raw =
      req.rawBody ??
      (typeof req.body === 'string'
        ? Buffer.from(req.body)
        : Buffer.from(JSON.stringify(req.body ?? {})));
    if (!signature?.startsWith('sha256=')) {
      throw new UnauthorizedException('missing signature');
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = signature.slice('sha256='.length);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('invalid signature');
    }
  }

  private async handlePush(body: Record<string, unknown>) {
    const repo = body.repository as { id?: number; full_name?: string; default_branch?: string } | undefined;
    const ref = String(body.ref ?? '');
    if (!repo?.id) throw new BadRequestException('repository.id required');

    const [link] = await db
      .select()
      .from(githubRepoLinks)
      .where(eq(githubRepoLinks.githubRepoId, repo.id))
      .limit(1);
    if (!link) {
      this.log.debug(`no link for github repo ${repo.id}`);
      return { ok: true, matched: false };
    }

    const [install] = await db
      .select()
      .from(githubAppInstalls)
      .where(
        and(
          eq(githubAppInstalls.id, link.installId),
          eq(githubAppInstalls.suspended, false),
        ),
      )
      .limit(1);
    if (!install) return { ok: true, matched: false, suspended: true };

    const branch = link.defaultBranch ?? repo.default_branch ?? 'main';
    if (ref !== `refs/heads/${branch}`) {
      return { ok: true, matched: true, skipped: 'non-default-branch' };
    }

    const [gwiRepo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, link.repoId))
      .limit(1);
    if (!gwiRepo) return { ok: true, matched: false };

    const [run] = await db
      .insert(analysisRuns)
      .values({
        repoId: gwiRepo.id,
        status: 'queued',
        sampleConfig: { lastN: 25, monthlyAnchors: false, tipOnly: true },
      })
      .returning();

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'clone',
        status: 'queued',
        orgId: gwiRepo.orgId,
        repoId: gwiRepo.id,
        runId: run!.id,
        progress: 0,
        payload: { remoteUrl: gwiRepo.remoteUrl, reason: 'github_push' },
      })
      .returning();

    await this.jobsService.enqueueClone({
      jobId: job!.id,
      runId: run!.id,
      repoId: gwiRepo.id,
      orgId: gwiRepo.orgId,
      remoteUrl: gwiRepo.remoteUrl,
      defaultBranch: branch,
      encryptedPat: gwiRepo.encryptedPat ?? undefined,
    });

    this.log.log(
      `tip reanalyze queued repo=${gwiRepo.id} run=${run!.id} ref=${ref}`,
    );
    return { ok: true, matched: true, runId: run!.id, jobId: job!.id };
  }
}
