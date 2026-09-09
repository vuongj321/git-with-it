import { createHash } from 'node:crypto';
import type {
  AiGenerateJobPayload,
  EvidenceBundle,
  InsightCandidate,
  InsightOutput,
  InsightSignal,
} from '@gwi/shared-types';
import { EvidenceBundleSchema, InsightOutputSchema, graphRefToEntityId, isEntityUuid } from '@gwi/shared-types';
import { apiJson, chunkArray, patchRun } from './api';
import { env } from './env';
import { logger } from './logger';

type RepoEntity = {
  id: string;
  repoId: string;
  kind: string;
  fqn: string;
  name: string;
  language: string | null;
  status: string;
};

type SampleCommit = {
  sha: string;
  topoIndex: number | null;
  reason?: string;
  message: string | null;
  authoredAt: string | null;
};

type EvolutionEvent = {
  id: string;
  type: string;
  severity: string;
  title: string;
  fromSha: string;
  toSha: string;
  authoredAt: string | null;
  payload?: Record<string, unknown>;
  entityIds?: string[];
};

type MetricsDeltaResponse = {
  from: string;
  to: string;
  movers: Array<{
    entityId: string;
    entityKind: string;
    metric: string;
    fromValue: number;
    toValue: number;
    delta: number;
  }>;
};

type TopMetricResponse = {
  values: Array<{ entityId: string; value: number }>;
};

type MetricSeriesResponse = {
  repoId: string;
  series: Array<{
    metric: string;
    entityId: string;
    points: Array<{
      commitSha: string;
      topoIndex: number;
      authoredAt: string | null;
      value: number;
    }>;
  }>;
};

type GraphDiffPayload = {
  nodesAdded?: Array<{ id: string }>;
  nodesRemoved?: Array<{ id: string }>;
  edgesAdded?: Array<{ from: string; to: string }>;
  edgesRemoved?: Array<{ from: string; to: string }>;
  highlightIds?: string[];
  highlight_subgraph?: string[];
};

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`;
}

function candidateKey(candidate: InsightCandidate): string {
  return sha256(
    canonicalize({
      type: candidate.type,
      fromSha: candidate.fromSha,
      toSha: candidate.toSha,
      entityIds: candidate.entityIds,
      signalRefs: candidate.signalRefs,
    }),
  );
}

function severityWeight(value: string): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[value] ?? 1;
}

function summarizeEntity(entity: RepoEntity | undefined, fallbackId: string) {
  return entity?.name || entity?.fqn || fallbackId;
}

function makeMockInsight(bundle: EvidenceBundle): InsightOutput {
  const primary = bundle.signals[0];
  const firstEntity = bundle.entities[0];
  const label = summarizeEntity(firstEntity as RepoEntity | undefined, firstEntity?.id ?? 'entity');
  const citedSignals = bundle.signals.slice(0, 3).map((signal) => signal.id);
  const severity =
    bundle.candidate.score >= 95
      ? 'critical'
      : bundle.candidate.score >= 75
        ? 'high'
        : bundle.candidate.score >= 55
          ? 'medium'
          : 'low';
  const category =
    bundle.candidate.type === 'hotspot'
      ? 'hotspot'
      : bundle.candidate.type === 'god_object'
        ? 'refactor'
        : primary?.kind === 'event'
          ? 'risk'
          : 'drift';
  return {
    headline: `${label} shows measurable architectural pressure`,
    narrative: [
      `Based on measured signals, ${label} was selected because ${primary?.label ?? 'its metrics changed materially'}.`,
      bundle.allowedClaims.slice(0, 3).join(' '),
      bundle.relatedEvents.length
        ? `Related events: ${bundle.relatedEvents
            .slice(0, 2)
            .map((event) => event.title)
            .join('; ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    severity,
    category,
    entityIds: bundle.entities.map((entity) => entity.id),
    confidence: Math.min(0.95, Math.max(0.55, bundle.candidate.score / 100)),
    suggestedActions: [
      `Inspect compare view for ${bundle.candidate.fromSha.slice(0, 7)} to ${bundle.candidate.toSha.slice(0, 7)}.`,
      `Review graph focus for ${label}.`,
    ],
    citedSignals,
  };
}

function validateInsight(bundle: EvidenceBundle, raw: unknown): InsightOutput {
  const parsed = InsightOutputSchema.parse(raw);
  const allowedSignals = new Set(bundle.signals.map((signal) => signal.id));
  const allowedEntities = new Set(bundle.entities.map((entity) => entity.id));
  if (!parsed.citedSignals.every((id) => allowedSignals.has(id))) {
    throw new Error('citedSignals must reference signal ids in bundle');
  }
  if (!parsed.entityIds.every((id) => allowedEntities.has(id))) {
    throw new Error('entityIds must reference entities in bundle');
  }
  return parsed;
}

async function callProvider(bundle: EvidenceBundle): Promise<{
  provider: string | null;
  model: string | null;
  promptHash: string | null;
  output: InsightOutput | null;
}> {
  const promptHash = sha256(
    [
      'architect narrator',
      'Only use entities, numbers, and claims from the evidence bundle.',
      'Return JSON only.',
      canonicalize(bundle),
    ].join('\n'),
  );

  if (env.AI_PROVIDER === 'disabled') {
    return { provider: null, model: null, promptHash, output: null };
  }

  if (env.AI_PROVIDER === 'mock') {
    return {
      provider: 'mock',
      model: env.AI_MODEL,
      promptHash,
      output: validateInsight(bundle, makeMockInsight(bundle)),
    };
  }

  const payloadText = JSON.stringify(bundle);
  const system =
    'You are an architecture analyst. Only restate facts present in the evidence bundle. Return JSON only.';
  const repair =
    'Previous response failed validation. Return valid JSON only, citing only allowed entities and signal ids.';

  async function parseResponse(text: string): Promise<InsightOutput> {
    const trimmed = text.trim();
    return validateInsight(bundle, JSON.parse(trimmed));
  }

  if (env.AI_PROVIDER === 'openai' && env.OPENAI_API_KEY) {
    const requestBody = {
      model: env.AI_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: payloadText },
      ],
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let text = json.choices?.[0]?.message?.content ?? '';
    try {
      return {
        provider: 'openai',
        model: env.AI_MODEL,
        promptHash,
        output: await parseResponse(text),
      };
    } catch {
      const retryRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...requestBody,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: payloadText },
            { role: 'user', content: repair },
          ],
        }),
      });
      const retryJson = (await retryRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      text = retryJson.choices?.[0]?.message?.content ?? '';
      return {
        provider: 'openai',
        model: env.AI_MODEL,
        promptHash,
        output: await parseResponse(text),
      };
    }
  }

  if (env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const requestBody = {
      model: env.AI_MODEL,
      max_tokens: 900,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: payloadText }] }],
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    let text = json.content?.find((item) => item.type === 'text')?.text ?? '';
    try {
      return {
        provider: 'anthropic',
        model: env.AI_MODEL,
        promptHash,
        output: await parseResponse(text),
      };
    } catch {
      const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...requestBody,
          messages: [
            { role: 'user', content: [{ type: 'text', text: payloadText }] },
            { role: 'user', content: [{ type: 'text', text: repair }] },
          ],
        }),
      });
      const retryJson = (await retryRes.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      text = retryJson.content?.find((item) => item.type === 'text')?.text ?? '';
      return {
        provider: 'anthropic',
        model: env.AI_MODEL,
        promptHash,
        output: await parseResponse(text),
      };
    }
  }

  return { provider: null, model: null, promptHash, output: null };
}

function rankAndDedupeCandidates(candidates: InsightCandidate[]): InsightCandidate[] {
  const seenKeys = new Set<string>();
  const entityCounts = new Map<string, number>();
  return candidates
    .slice()
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const key = candidateKey(candidate);
      if (seenKeys.has(key)) return false;
      const primaryEntity = candidate.entityIds[0] ?? candidate.id;
      const count = entityCounts.get(primaryEntity) ?? 0;
      if (count >= 2) return false;
      seenKeys.add(key);
      entityCounts.set(primaryEntity, count + 1);
      return true;
    })
    .slice(0, 10);
}

async function buildEvidenceBundle(args: {
  repoId: string;
  orgId: string;
  runId: string;
  candidate: InsightCandidate;
  commits: SampleCommit[];
  allEvents: EvolutionEvent[];
  entityMap: Map<string, RepoEntity>;
  overallDiff: GraphDiffPayload;
}): Promise<{ bundle: EvidenceBundle; evidenceHash: string }> {
  const metrics = (
    await Promise.all(
      args.candidate.entityIds.map((entityId) =>
        apiJson<MetricSeriesResponse>(
          `/v1/repos/${args.repoId}/metrics?orgId=${args.orgId}&entity=${entityId}&from=${args.candidate.fromSha}&to=${args.candidate.toSha}&names=fan_in,fan_out,complexity_proxy,loc`,
        ),
      ),
    )
  ).flatMap((result) => result.series);

  const signals: InsightSignal[] = [];
  const relatedEvents = args.allEvents
    .filter(
      (event) =>
        (event.fromSha === args.candidate.fromSha && event.toSha === args.candidate.toSha) ||
        (event.entityIds ?? []).some((id) => args.candidate.entityIds.includes(id)),
    )
    .slice(0, 8)
    .map((event) => {
      signals.push({
        id: `event:${event.id}`,
        kind: 'event',
        entityId: event.entityIds?.[0] ?? null,
        label: event.title,
        severity: event.severity,
        fromSha: event.fromSha,
        toSha: event.toSha,
      });
      return {
        id: event.id,
        type: event.type,
        severity: event.severity,
        title: event.title,
        entityIds: event.entityIds ?? [],
        fromSha: event.fromSha,
        toSha: event.toSha,
      };
    });

  for (const series of metrics) {
    const first = series.points[0];
    const last = series.points[series.points.length - 1];
    if (!first || !last || first.value === last.value) continue;
    signals.push({
      id: `metric:${series.entityId}:${series.metric}`,
      kind: 'metric_delta',
      entityId: series.entityId,
      metric: series.metric,
      label: `${series.metric} ${first.value} -> ${last.value}`,
      fromValue: first.value,
      toValue: last.value,
      delta: last.value - first.value,
      fromSha: first.commitSha,
      toSha: last.commitSha,
    });
  }

  signals.push({
    id: `diff:${args.candidate.fromSha}:${args.candidate.toSha}`,
    kind: 'graph_diff',
    label: `graph diff ${args.candidate.fromSha.slice(0, 7)} -> ${args.candidate.toSha.slice(0, 7)}`,
    fromValue: args.overallDiff.nodesAdded?.length ?? 0,
    toValue: args.overallDiff.edgesAdded?.length ?? 0,
    delta:
      (args.overallDiff.edgesAdded?.length ?? 0) -
      (args.overallDiff.edgesRemoved?.length ?? 0),
    fromSha: args.candidate.fromSha,
    toSha: args.candidate.toSha,
  });

  const entities = args.candidate.entityIds
    .map((id) => args.entityMap.get(id))
    .filter(Boolean)
    .map((entity) => ({
      id: entity!.id,
      fqn: entity!.fqn,
      kind: entity!.kind,
      name: entity!.name,
    }));

  const allowedClaims = [
    ...signals
      .filter((signal) => signal.kind !== 'graph_diff')
      .map((signal) => signal.label),
    ...metrics.flatMap((series) => {
      const first = series.points[0];
      const last = series.points[series.points.length - 1];
      return first && last
        ? [`${series.metric} ${series.entityId} ${first.value} -> ${last.value}`]
        : [];
    }),
  ].slice(0, 16);

  const bundle = EvidenceBundleSchema.parse({
    version: 'evidence_v1',
    candidate: args.candidate,
    entities,
    signals,
    metrics: metrics.map((series) => ({
      entityId: series.entityId,
      metric: series.metric,
      points: series.points.map((point) => ({
        commitSha: point.commitSha,
        topoIndex: point.topoIndex,
        value: point.value,
      })),
    })),
    relatedEvents,
    diffSummary: {
      nodesAdded: args.overallDiff.nodesAdded?.length ?? 0,
      nodesRemoved: args.overallDiff.nodesRemoved?.length ?? 0,
      edgesAdded: args.overallDiff.edgesAdded?.length ?? 0,
      edgesRemoved: args.overallDiff.edgesRemoved?.length ?? 0,
      highlightIds: args.overallDiff.highlightIds ?? args.overallDiff.highlight_subgraph ?? [],
    },
    allowedClaims,
    meta: {
      repoId: args.repoId,
      runId: args.runId,
      analyzerVersion: null,
      generatedAt: new Date().toISOString(),
    },
  });
  return { bundle, evidenceHash: sha256(canonicalize(bundle)) };
}

export async function processAiGenerateJob(payload: AiGenerateJobPayload) {
  const log = logger.child({ job: 'ai', runId: payload.runId, repoId: payload.repoId });
  try {
    await patchRun(payload.runId, {
      status: 'ai_generating',
      jobStatus: 'active',
      progress: 5,
    });

    const commits = await apiJson<SampleCommit[]>(
      `/v1/repos/${payload.repoId}/commits?orgId=${payload.orgId}&sampled=true&runId=${payload.runId}&limit=500`,
    );
    if (commits.length < 2) {
      await patchRun(payload.runId, {
        status: 'evolution_ready',
        jobStatus: 'completed',
        progress: 100,
        error: null,
      });
      return;
    }

    const firstSha = commits[0]!.sha;
    const lastSha = commits[commits.length - 1]!.sha;
    const [events, deltas, topFanIn, topLoc, overallDiff] = await Promise.all([
      apiJson<EvolutionEvent[]>(
        `/v1/repos/${payload.repoId}/timeline?orgId=${payload.orgId}&limit=300`,
      ),
      apiJson<MetricsDeltaResponse>(
        `/v1/repos/${payload.repoId}/metrics/delta?orgId=${payload.orgId}&from=${firstSha}&to=${lastSha}&limit=50`,
      ),
      apiJson<TopMetricResponse>(
        `/v1/repos/${payload.repoId}/metrics/top?orgId=${payload.orgId}&sha=${lastSha}&metric=fan_in&view=package&limit=10`,
      ),
      apiJson<TopMetricResponse>(
        `/v1/repos/${payload.repoId}/metrics/top?orgId=${payload.orgId}&sha=${lastSha}&metric=loc&view=file&limit=10`,
      ),
      apiJson<GraphDiffPayload>(
        `/v1/repos/${payload.repoId}/graph/diff?orgId=${payload.orgId}&from=${firstSha}&to=${lastSha}`,
      ),
    ]);

    const candidates: InsightCandidate[] = [];
    for (const event of events) {
      const entityIds = [
        ...new Set(
          (event.entityIds ?? []).map((id) => graphRefToEntityId(payload.repoId, id)),
        ),
      ].filter(isEntityUuid);
      if (!entityIds.length) continue;
      if (severityWeight(event.severity) < severityWeight('medium')) continue;
      candidates.push({
        id: `event:${event.id}`,
        type: 'evolution_event',
        title: event.title,
        entityIds,
        fromSha: event.fromSha,
        toSha: event.toSha,
        score: severityWeight(event.severity) * 20 + (entityIds.length === 1 ? 8 : 0),
        signalRefs: [`event:${event.id}`],
      });
    }

    for (const mover of deltas.movers) {
      if (Math.abs(mover.delta) < 3) continue;
      candidates.push({
        id: `delta:${mover.entityId}:${mover.metric}`,
        type: 'metric_delta',
        title: `${mover.metric} changed for ${mover.entityId.slice(0, 8)}`,
        entityIds: [mover.entityId],
        fromSha: deltas.from,
        toSha: deltas.to,
        score: Math.min(96, Math.abs(mover.delta) * 4),
        signalRefs: [`metric:${mover.entityId}:${mover.metric}`],
      });
    }

    for (const row of topFanIn.values.slice(0, 5)) {
      candidates.push({
        id: `hotspot:fanin:${row.entityId}`,
        type: 'hotspot',
        title: `High fan-in hotspot ${row.entityId.slice(0, 8)}`,
        entityIds: [row.entityId],
        fromSha: firstSha,
        toSha: lastSha,
        score: Math.min(88, 40 + row.value * 2),
        signalRefs: [`metric:${row.entityId}:fan_in`],
      });
    }

    for (const row of topLoc.values.slice(0, 3)) {
      candidates.push({
        id: `hotspot:loc:${row.entityId}`,
        type: 'god_object',
        title: `Large file hotspot ${row.entityId.slice(0, 8)}`,
        entityIds: [row.entityId],
        fromSha: firstSha,
        toSha: lastSha,
        score: Math.min(82, 35 + row.value / 20),
        signalRefs: [`metric:${row.entityId}:loc`],
      });
    }

    const selected = rankAndDedupeCandidates(candidates);
    if (selected.length === 0) {
      await patchRun(payload.runId, {
        status: 'evolution_ready',
        jobStatus: 'completed',
        progress: 100,
        error: null,
      });
      return;
    }

    const entityIds = [
      ...new Set(selected.flatMap((candidate) => candidate.entityIds)),
    ].filter(isEntityUuid);
    const entities =
      entityIds.length === 0
        ? []
        : await apiJson<RepoEntity[]>(
            `/v1/repos/${payload.repoId}/entities?orgId=${payload.orgId}&ids=${entityIds.join(',')}&limit=${entityIds.length}`,
          );
    const entityMap = new Map(entities.map((entity) => [entity.id, entity]));

    const evidence: Array<{ evidenceHash: string; bundle: EvidenceBundle }> = [];
    const candidateRows: Array<{
      candidateKey: string;
      type: string;
      title: string;
      score: number;
      fromSha: string;
      toSha: string;
      entityIds: string[];
      signalRefs: string[];
      evidenceHash: string | null;
      status: string;
    }> = [];
    const insightRows: Array<{
      candidateKey: string;
      headline: string;
      narrative: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      category: 'debt' | 'drift' | 'risk' | 'refactor' | 'hotspot';
      entityIds: string[];
      fromSha: string;
      toSha: string;
      evidenceHash: string;
      model: string | null;
      provider: string | null;
      promptHash: string | null;
      confidence: number;
      status: 'published' | 'failed_validation' | 'skipped_no_provider';
      suggestedActions: string[];
      citedSignals: string[];
    }> = [];

    const aiEnabled =
      env.AI_PROVIDER === 'mock' ||
      (env.AI_PROVIDER === 'openai' && Boolean(env.OPENAI_API_KEY)) ||
      (env.AI_PROVIDER === 'anthropic' && Boolean(env.ANTHROPIC_API_KEY));

    for (let i = 0; i < selected.length; i++) {
      const candidate = selected[i]!;
      const key = candidateKey(candidate);
      const { bundle, evidenceHash } = await buildEvidenceBundle({
        repoId: payload.repoId,
        orgId: payload.orgId,
        runId: payload.runId,
        candidate,
        commits,
        allEvents: events,
        entityMap,
        overallDiff,
      });
      evidence.push({ evidenceHash, bundle });

      let status = aiEnabled ? 'queued' : 'skipped_no_provider';
      let output: InsightOutput | null = null;
      let provider: string | null = null;
      let model: string | null = null;
      let promptHash: string | null = null;

      if (bundle.signals.length && aiEnabled) {
        try {
          const generated = await callProvider(bundle);
          output = generated.output;
          provider = generated.provider;
          model = generated.model;
          promptHash = generated.promptHash;
          status = output ? 'published' : 'skipped_no_provider';
        } catch (err) {
          log.warn({ candidate: key, err: err instanceof Error ? err.message : String(err) }, 'validation failed');
          status = 'failed_validation';
        }
      }

      candidateRows.push({
        candidateKey: key,
        type: candidate.type,
        title: candidate.title,
        score: candidate.score,
        fromSha: candidate.fromSha,
        toSha: candidate.toSha,
        entityIds: candidate.entityIds,
        signalRefs: candidate.signalRefs,
        evidenceHash,
        status,
      });

      if (output) {
        insightRows.push({
          candidateKey: key,
          headline: output.headline,
          narrative: output.narrative,
          severity: output.severity,
          category: output.category,
          entityIds: output.entityIds,
          fromSha: candidate.fromSha,
          toSha: candidate.toSha,
          evidenceHash,
          model,
          provider,
          promptHash,
          confidence: output.confidence,
          status: 'published',
          suggestedActions: output.suggestedActions,
          citedSignals: output.citedSignals,
        });
      }

      await patchRun(payload.runId, {
        status: 'ai_generating',
        progress: 10 + Math.round(((i + 1) / selected.length) * 80),
      });
    }

    // Evidence bundles are large — post in small batches to stay under body limits.
    const evidenceBatches = chunkArray(evidence, 2);
    for (const evBatch of evidenceBatches) {
      const hashes = new Set(evBatch.map((item) => item.evidenceHash));
      await apiJson(`/v1/internal/repos/${payload.repoId}/insights/batch-upsert`, {
        method: 'POST',
        body: {
          runId: payload.runId,
          analyzerVersion: null,
          providerState: aiEnabled ? 'published' : 'skipped_no_provider',
          evidence: evBatch,
          candidates: candidateRows.filter(
            (row) => row.evidenceHash && hashes.has(row.evidenceHash),
          ),
          insights: insightRows.filter((row) => hashes.has(row.evidenceHash)),
        },
      });
    }

    await patchRun(payload.runId, {
      status: 'evolution_ready',
      jobStatus: 'completed',
      progress: 100,
      error: null,
    });
    log.info({ candidates: candidateRows.length, insights: insightRows.length }, 'ai generation complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'ai generation failed');
    await patchRun(payload.runId, {
      status: 'failed',
      jobStatus: 'failed',
      progress: 100,
      error: message,
    }).catch(() => undefined);
    throw err;
  }
}
