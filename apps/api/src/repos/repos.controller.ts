import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateRepoBodySchema,
  SampleConfigSchema,
  diffGraphs,
  graphRefToEntityId,
  isEntityUuid,
  isLikelyGitRemoteUrl,
  type GraphSnapshot,
} from '@gwi/shared-types';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session.guard';
import { OrgMembershipGuard } from '../auth/org-membership.guard';
import { OrgIdParam } from '../auth/org.decorator';
import { db } from '../db/client';
import {
  analysisRuns,
  commitSamples,
  commits,
  entities,
  evolutionEvents,
  graphDeltas,
  insights,
  jobs,
  repositories,
} from '../db/schema';
import {
  cacheGet,
  cacheSet,
  graphCacheKey,
  metricsCacheKey,
} from '../cache/redis-cache';
import { queryGraphSlice } from '../graph/neo4j';
import { JobsService } from '../jobs/jobs.service';
import { QuotasService } from '../billing/quotas.service';
import {
  orchestratorMode,
  startAnalysisWorkflow,
} from '../temporal/client';
import {
  queryCycleMembers,
  queryHeatmap,
  queryMetricDelta,
  queryMetricSeries,
  querySummary,
  queryTopMetrics,
} from '../metrics/clickhouse';

const AnalyzeBody = z.object({
  defaultBranch: z.string().min(1).optional(),
  sampleConfig: SampleConfigSchema.partial().optional(),
});

const GraphQuery = z.object({
  sha: z.string().min(7).optional(),
  view: z.enum(['package', 'file']).default('package'),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

const EntitiesQuery = z.object({
  q: z.string().min(1).optional(),
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CommitsQuery = z.object({
  sampled: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  runId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const DiffQuery = z.object({
  from: z.string().min(7),
  to: z.string().min(7),
});

const TimelineQuery = z.object({
  from: z.string().min(7).optional(),
  to: z.string().min(7).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const CompareBody = z.object({
  from: z.string().min(7),
  to: z.string().min(7),
});

const MetricsSeriesQuery = z.object({
  names: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? 'fan_in,fan_out,complexity_proxy,loc,cycle_count')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  entity: z.string().uuid().optional(),
  from: z.string().min(7).optional(),
  to: z.string().min(7).optional(),
});

const HeatmapQuery = z.object({
  sha: z.string().min(7),
  metric: z.string().min(1).default('fan_in'),
  view: z.enum(['package', 'file']).default('package'),
});

const SummaryQuery = z.object({
  sha: z.string().min(7).optional(),
});

const MetricsDeltaQuery = z.object({
  from: z.string().min(7),
  to: z.string().min(7),
  metric: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const TopMetricsQuery = z.object({
  sha: z.string().min(7),
  metric: z.string().min(1).default('fan_in'),
  view: z.enum(['package', 'file']).default('package'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const InsightsQuery = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  category: z.enum(['debt', 'drift', 'risk', 'refactor', 'hotspot']).optional(),
  /** Product entity UUID or graph-local ref (`file:…`, `pkg:…`). */
  entity: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@ApiTags('repos')
@ApiBearerAuth()
@Controller('v1/repos')
@UseGuards(JwtOrSessionAuthGuard, OrgMembershipGuard)
export class ReposController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly quotas: QuotasService,
  ) {}

  @Post()
  async create(@Body() body: unknown, @Req() _req: Request) {
    const parsed = CreateRepoBodySchema.parse(body);
    if (!isLikelyGitRemoteUrl(parsed.remoteUrl)) {
      throw new BadRequestException('remoteUrl must be an http(s) git remote');
    }
    await this.quotas.ensureFreeSubscription(parsed.orgId);
    await this.quotas.assertCanAddRepo(parsed.orgId);
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

  @Get(':id/commits')
  async listCommits(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = CommitsQuery.parse(query);

    if (parsed.sampled) {
      let runId = parsed.runId;
      if (!runId) {
        const [latest] = await db
          .select()
          .from(analysisRuns)
          .where(eq(analysisRuns.repoId, repo.id))
          .orderBy(desc(analysisRuns.createdAt))
          .limit(1);
        runId = latest?.id;
      }
      if (!runId) return [];
      const rows = await db
        .select({
          sha: commitSamples.sha,
          topoIndex: commitSamples.topoIndex,
          reason: commitSamples.reason,
          authoredAt: commits.authoredAt,
          message: commits.message,
          parentShas: commits.parentShas,
        })
        .from(commitSamples)
        .leftJoin(
          commits,
          and(eq(commits.repoId, repo.id), eq(commits.sha, commitSamples.sha)),
        )
        .where(
          and(eq(commitSamples.repoId, repo.id), eq(commitSamples.runId, runId)),
        )
        .orderBy(asc(commitSamples.topoIndex))
        .limit(parsed.limit);
      return rows.map((r) => ({
        sha: r.sha,
        topoIndex: r.topoIndex,
        reason: r.reason,
        authoredAt: r.authoredAt?.toISOString() ?? null,
        message: r.message ?? null,
        parentShas: r.parentShas ?? [],
        sampled: true,
      }));
    }

    const rows = await db
      .select()
      .from(commits)
      .where(eq(commits.repoId, repo.id))
      .orderBy(desc(commits.authoredAt))
      .limit(parsed.limit);
    return rows.map((c) => ({
      sha: c.sha,
      topoIndex: c.topoIndex,
      authoredAt: c.authoredAt?.toISOString() ?? null,
      message: c.message,
      parentShas: c.parentShas,
      sampled: false,
    }));
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

    const [commit] = await db
      .select()
      .from(commits)
      .where(and(eq(commits.repoId, repo.id), eq(commits.sha, sha)))
      .limit(1);

    const cacheKey = graphCacheKey(repo.id, sha, parsed.view, 'root', '0');
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return cached;

    try {
      const slice = await queryGraphSlice({
        repoId: repo.id,
        sha,
        topoIndex: commit?.topoIndex ?? null,
        view: parsed.view,
        maxNodes: parsed.limit,
      });
      await cacheSet(cacheKey, slice, 120);
      return slice;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`graph query failed: ${message}`);
    }
  }

  @Get(':id/metrics')
  async metricsSeries(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = MetricsSeriesQuery.parse(query);
    const range = `${parsed.from ?? ''}:${parsed.to ?? ''}`;
    const cacheKey = metricsCacheKey(
      repo.id,
      parsed.entity ?? 'all',
      parsed.names.join(','),
      range,
    );
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return cached;

    let fromTopo: number | undefined;
    let toTopo: number | undefined;
    if (parsed.from) {
      const [c] = await db
        .select()
        .from(commits)
        .where(and(eq(commits.repoId, repo.id), eq(commits.sha, parsed.from)))
        .limit(1);
      fromTopo = c?.topoIndex ?? undefined;
    }
    if (parsed.to) {
      const [c] = await db
        .select()
        .from(commits)
        .where(and(eq(commits.repoId, repo.id), eq(commits.sha, parsed.to)))
        .limit(1);
      toTopo = c?.topoIndex ?? undefined;
    }

    const series = await queryMetricSeries({
      repoId: repo.id,
      names: parsed.names,
      entityId: parsed.entity,
      fromTopo,
      toTopo,
    });
    const payload = { repoId: repo.id, series };
    await cacheSet(cacheKey, payload, 300);
    return payload;
  }

  @Get(':id/metrics/heatmap')
  async metricsHeatmap(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = HeatmapQuery.parse(query);
    const cacheKey = metricsCacheKey(
      repo.id,
      parsed.view,
      parsed.metric,
      `heatmap:${parsed.sha}`,
    );
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return cached;
    const values = await queryHeatmap({
      repoId: repo.id,
      sha: parsed.sha,
      metric: parsed.metric,
      view: parsed.view,
    });
    const entityRows = await db
      .select({ id: entities.id, fqn: entities.fqn, kind: entities.kind })
      .from(entities)
      .where(eq(entities.repoId, repo.id));
    const byId = new Map(entityRows.map((e) => [e.id, e]));
    const enriched = values.map((v) => {
      const ent = byId.get(v.entityId);
      const graphId = ent
        ? ent.kind === 'package'
          ? `pkg:${ent.fqn}`
          : ent.kind === 'file'
            ? `file:${ent.fqn}`
            : ent.fqn
        : v.entityId;
      return { ...v, fqn: ent?.fqn ?? null, graphId };
    });
    const payload = {
      sha: parsed.sha,
      metric: parsed.metric,
      view: parsed.view,
      values: enriched,
    };
    await cacheSet(cacheKey, payload, 300);
    return payload;
  }

  @Get(':id/metrics/summary')
  async metricsSummary(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = SummaryQuery.parse(query);
    const sha = parsed.sha ?? repo.lastSyncedSha;
    if (!sha) throw new BadRequestException('sha required');
    const cacheKey = metricsCacheKey(repo.id, 'repo', 'summary', sha);
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return cached;
    const summary = await querySummary({ repoId: repo.id, sha });
    await cacheSet(cacheKey, summary, 300);
    return summary;
  }

  @Get(':id/metrics/delta')
  async metricsDelta(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = MetricsDeltaQuery.parse(query);
    const movers = await queryMetricDelta({
      repoId: repo.id,
      fromSha: parsed.from,
      toSha: parsed.to,
      metric: parsed.metric,
      limit: parsed.limit,
    });
    return { from: parsed.from, to: parsed.to, movers };
  }

  @Get(':id/metrics/top')
  async metricsTop(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = TopMetricsQuery.parse(query);
    const values = await queryTopMetrics({
      repoId: repo.id,
      sha: parsed.sha,
      metric: parsed.metric,
      view: parsed.view,
      limit: parsed.limit,
    });
    return { sha: parsed.sha, metric: parsed.metric, view: parsed.view, values };
  }

  @Get(':id/metrics/cycles')
  async metricsCycles(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query('sha') sha: string,
  ) {
    const repo = await this.requireRepo(id, orgId);
    if (!sha) throw new BadRequestException('sha required');
    const members = await queryCycleMembers({ repoId: repo.id, sha });
    return { sha, members };
  }

  @Get(':id/graph/diff')
  async graphDiff(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = DiffQuery.parse(query);
    await this.assertCompareAllowed(repo.id, parsed.from, parsed.to);

    const fromSnap = await this.loadSnapshotJson(repo.id, parsed.from);
    const toSnap = await this.loadSnapshotJson(repo.id, parsed.to);
    const diff = diffGraphs(fromSnap, toSnap);
    return {
      ...diff,
      highlight_subgraph: diff.highlightIds,
    };
  }

  @Post(':id/compare')
  async compare(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = CompareBody.parse(body);
    await this.assertCompareAllowed(repo.id, parsed.from, parsed.to);
    const fromSnap = await this.loadSnapshotJson(repo.id, parsed.from);
    const toSnap = await this.loadSnapshotJson(repo.id, parsed.to);
    const diff = diffGraphs(fromSnap, toSnap);
    return {
      id: `${parsed.from}_${parsed.to}`,
      from: parsed.from,
      to: parsed.to,
      diff: {
        ...diff,
        highlight_subgraph: diff.highlightIds,
      },
    };
  }

  @Get(':id/timeline')
  async timeline(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = TimelineQuery.parse(query);

    const conditions = [eq(evolutionEvents.repoId, repo.id)];
    // Optional sha range filter via topo if both provided
    if (parsed.from && parsed.to) {
      const [fromC] = await db
        .select()
        .from(commits)
        .where(and(eq(commits.repoId, repo.id), eq(commits.sha, parsed.from)))
        .limit(1);
      const [toC] = await db
        .select()
        .from(commits)
        .where(and(eq(commits.repoId, repo.id), eq(commits.sha, parsed.to)))
        .limit(1);
      if (fromC?.topoIndex != null && toC?.topoIndex != null) {
        // Filter events whose to_sha topo is within range — approximate via sha match list
        void fromC;
        void toC;
      }
      conditions.push(eq(evolutionEvents.fromSha, parsed.from));
      // soft filter: events between — keep all matching repo and let client filter
    }

    const rows = await db
      .select()
      .from(evolutionEvents)
      .where(and(...conditions))
      .orderBy(desc(evolutionEvents.authoredAt), desc(evolutionEvents.createdAt))
      .limit(parsed.limit);

    let filtered = rows;
    if (parsed.from || parsed.to) {
      const topoRows = await db
        .select()
        .from(commits)
        .where(eq(commits.repoId, repo.id));
      const topo = new Map(topoRows.map((c) => [c.sha, c.topoIndex ?? -1]));
      const fromIdx = parsed.from ? (topo.get(parsed.from) ?? 0) : 0;
      const toIdx = parsed.to
        ? (topo.get(parsed.to) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      filtered = rows.filter((e) => {
        const i = topo.get(e.toSha) ?? -1;
        return i >= fromIdx && i <= toIdx;
      });
    }

    return filtered.map((e) => ({
      id: e.id,
      repoId: e.repoId,
      fromSha: e.fromSha,
      toSha: e.toSha,
      authoredAt: e.authoredAt?.toISOString() ?? null,
      type: e.type,
      severity: e.severity,
      title: e.title,
      payload: e.payload,
      entityIds: e.entityIds,
    }));
  }

  @Get(':id/insights')
  async listInsights(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = InsightsQuery.parse(query);
    const conditions = [eq(insights.repoId, repo.id)];
    if (parsed.severity) conditions.push(eq(insights.severity, parsed.severity));
    if (parsed.category) conditions.push(eq(insights.category, parsed.category));

    const entityFilter = parsed.entity
      ? isEntityUuid(parsed.entity)
        ? parsed.entity
        : graphRefToEntityId(repo.id, parsed.entity)
      : null;

    let rows = await db
      .select()
      .from(insights)
      .where(and(...conditions))
      .orderBy(desc(insights.createdAt))
      .limit(entityFilter ? parsed.limit * 3 : parsed.limit);
    const now = Date.now();
    rows = rows.filter(
      (row) =>
        !row.dismissedAt &&
        (!row.snoozedUntil || row.snoozedUntil.getTime() <= now),
    );
    if (entityFilter) {
      rows = rows
        .filter((row) => (row.entityIds ?? []).includes(entityFilter))
        .slice(0, parsed.limit);
    }
    return rows.slice(0, parsed.limit).map(serializeInsight);
  }

  @Get(':id/insights/:insightId')
  async getInsight(
    @Param('id') id: string,
    @Param('insightId') insightId: string,
    @Query('orgId') orgId: string,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const [row] = await db
      .select()
      .from(insights)
      .where(and(eq(insights.repoId, repo.id), eq(insights.id, insightId)))
      .limit(1);
    if (!row) throw new NotFoundException('Insight not found');
    return serializeInsight(row);
  }

  @Post(':id/insights/:insightId/dismiss')
  async dismissInsight(
    @Param('id') id: string,
    @Param('insightId') insightId: string,
    @Query('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = z
      .object({
        snoozeDays: z.number().int().min(1).max(365).optional(),
        feedback: z.enum(['up', 'down']).optional(),
        note: z.string().max(2000).optional(),
      })
      .safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const [row] = await db
      .select()
      .from(insights)
      .where(and(eq(insights.repoId, repo.id), eq(insights.id, insightId)))
      .limit(1);
    if (!row) throw new NotFoundException('Insight not found');

    const snoozedUntil = parsed.data.snoozeDays
      ? new Date(Date.now() + parsed.data.snoozeDays * 86_400_000)
      : null;

    const [updated] = await db
      .update(insights)
      .set({
        dismissedAt: parsed.data.snoozeDays ? null : new Date(),
        snoozedUntil,
        feedback: parsed.data.feedback ?? row.feedback,
        feedbackNote: parsed.data.note ?? row.feedbackNote,
      })
      .where(eq(insights.id, row.id))
      .returning();
    return serializeInsight(updated!);
  }

  @Get(':id/entities/:entityId/insights')
  async entityInsights(
    @Param('id') id: string,
    @Param('entityId') entityId: string,
    @Query('orgId') orgId: string,
    @Query() query: Record<string, string>,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const parsed = InsightsQuery.parse(query);
    const decoded = decodeURIComponent(entityId);
    const resolved = isEntityUuid(decoded)
      ? decoded
      : graphRefToEntityId(repo.id, decoded);
    let rows = await db
      .select()
      .from(insights)
      .where(eq(insights.repoId, repo.id))
      .orderBy(desc(insights.createdAt))
      .limit(parsed.limit * 3);
    rows = rows.filter((row) => (row.entityIds ?? []).includes(resolved));
    if (parsed.severity) rows = rows.filter((row) => row.severity === parsed.severity);
    if (parsed.category) rows = rows.filter((row) => row.category === parsed.category);
    return rows.slice(0, parsed.limit).map(serializeInsight);
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
    const ids = parsed.ids.filter(isEntityUuid);
    const rows = ids.length
      ? (await db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.repoId, repo.id),
              or(...ids.map((value) => eq(entities.id, value))),
            ),
          )
          .limit(limit))
      : parsed.q
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
      : parsed.ids.length
        ? []
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
    await this.quotas.ensureFreeSubscription(repo.orgId);
    await this.quotas.assertCanAnalyze(repo.orgId);

    const [run] = await db
      .insert(analysisRuns)
      .values({
        repoId: repo.id,
        status: 'queued',
        sampleConfig: parsed.data.sampleConfig ?? {},
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

    const clonePayload = {
      jobId: job!.id,
      runId: run!.id,
      repoId: repo.id,
      orgId: repo.orgId,
      remoteUrl: repo.remoteUrl,
      defaultBranch: parsed.data.defaultBranch ?? repo.defaultBranch,
      encryptedPat: repo.encryptedPat ?? undefined,
    };

    if (orchestratorMode() === 'temporal') {
      await startAnalysisWorkflow(clonePayload);
    } else {
      await this.jobsService.enqueueClone(clonePayload);
    }

    return {
      run: serializeRun(run!),
      job: { id: job!.id, status: job!.status },
      orchestrator: orchestratorMode(),
    };
  }

  @Post(':id/runs/:runId/insights/regenerate')
  async regenerateInsights(
    @Param('id') id: string,
    @Param('runId') runId: string,
    @Query('orgId') orgId: string,
  ) {
    const repo = await this.requireRepo(id, orgId);
    const [run] = await db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.repoId, repo.id)))
      .limit(1);
    if (!run) throw new NotFoundException('Run not found');
    const sampleShas = (run.sampleShas ?? []).filter(Boolean);
    if (sampleShas.length === 0) {
      throw new BadRequestException('Run has no sampled SHAs');
    }

    await this.quotas.assertCanEnqueueAi(repo.orgId);
    await this.quotas.recordAiCall(repo.orgId, 1);

    await this.jobsService.enqueueAi({
      jobId: randomUUID(),
      runId: run.id,
      repoId: repo.id,
      orgId: repo.orgId,
      sampleShas,
      sampleConfig: (run.sampleConfig as Record<string, unknown> | null) ?? undefined,
    });
    await db
      .update(analysisRuns)
      .set({ status: 'ai_generating', finishedAt: null })
      .where(eq(analysisRuns.id, run.id));
    return { ok: true };
  }

  @Get(':id/runs/latest')
  async latestRun(@Param('id') id: string, @Query('orgId') orgId: string) {
    await this.requireRepo(id, orgId);
    const rows = await db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.repoId, id))
      .orderBy(desc(analysisRuns.createdAt))
      .limit(1);
    const run = rows[0];
    if (!run) throw new NotFoundException('No analysis runs for this repository');
    return serializeRun(run);
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

  private async assertCompareAllowed(repoId: string, from: string, to: string) {
    const samples = await db
      .select()
      .from(commits)
      .where(eq(commits.repoId, repoId));
    const topo = new Map(
      samples
        .filter((c) => c.topoIndex != null)
        .map((c) => [c.sha, c.topoIndex as number]),
    );
    const fromIdx = topo.get(from);
    const toIdx = topo.get(to);
    if (fromIdx == null || toIdx == null) {
      // Allow if snapshots exist; hop check skipped
      return;
    }
    const hops = Math.abs(toIdx - fromIdx);
    const maxHops = 200;
    if (hops > maxHops) {
      const ckpts = await db
        .select()
        .from(graphDeltas)
        .where(
          and(eq(graphDeltas.repoId, repoId), eq(graphDeltas.isCheckpoint, true)),
        );
      if (ckpts.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.PRECONDITION_FAILED,
            message: `Compare spans ${hops} samples (>${maxHops}) without checkpoints. Narrow the range or wait for checkpoint artifacts.`,
          },
          HttpStatus.PRECONDITION_FAILED,
        );
      }
    }
  }

  private async loadSnapshotJson(repoId: string, sha: string): Promise<GraphSnapshot> {
    // Prefer S3 via env — for API we reconstruct from Neo4j slice + empty fallback
    // Snapshots are also queryable: try reading graph_deltas is not enough.
    // Use Neo4j materialization at topo, or return empty if missing.
    const [commit] = await db
      .select()
      .from(commits)
      .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
      .limit(1);
    const slice = await queryGraphSlice({
      repoId,
      sha,
      topoIndex: commit?.topoIndex ?? null,
      view: 'file',
      maxNodes: 500,
    });
    const pkg = await queryGraphSlice({
      repoId,
      sha,
      topoIndex: commit?.topoIndex ?? null,
      view: 'package',
      maxNodes: 500,
    });
    const nodes = [
      ...slice.nodes.map((n) => ({
        id: String(n.id),
        kind: String(n.kind ?? 'file'),
        fqn: String(n.fqn ?? n.id),
        name: String(n.name ?? n.id),
        path: (n.path as string) ?? null,
        language: (n.language as string) ?? null,
        package: (n.package as string) ?? null,
      })),
      ...pkg.nodes.map((n) => ({
        id: String(n.id),
        kind: String(n.kind ?? 'package'),
        fqn: String(n.fqn ?? n.id),
        name: String(n.name ?? n.id),
        path: (n.path as string) ?? null,
        language: (n.language as string) ?? null,
        package: (n.package as string) ?? null,
      })),
    ];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = [...slice.edges, ...pkg.edges];
    return {
      sha,
      nodes: [...byId.values()],
      edges,
    };
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
    precisionMode: repo.precisionMode ?? 'structural',
    features: repo.features ?? {},
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
    sampleShas: run.sampleShas ?? [],
    commitsDone: run.commitsDone ?? 0,
    commitsTotal: run.commitsTotal ?? 0,
    triggeredBy: run.triggeredBy,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

function serializeInsight(row: typeof insights.$inferSelect) {
  return {
    id: row.id,
    repoId: row.repoId,
    runId: row.runId,
    headline: row.headline,
    narrative: row.narrative,
    severity: row.severity,
    category: row.category,
    entityIds: row.entityIds ?? [],
    fromSha: row.fromSha,
    toSha: row.toSha,
    evidenceHash: row.evidenceHash,
    model: row.model,
    provider: row.provider,
    promptHash: row.promptHash,
    confidence: row.confidence,
    status: row.status,
    suggestedActions: row.suggestedActions ?? [],
    citedSignals: row.citedSignals ?? [],
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    feedback: row.feedback ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
