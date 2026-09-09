import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { env } from '../config/env';
import type { MetricRow } from '@gwi/shared-types';

let client: ClickHouseClient | null = null;
let schemaReady = false;

export function getClickHouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: env.CLICKHOUSE_URL,
      username: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
      database: env.CLICKHOUSE_DATABASE,
    });
  }
  return client;
}

export async function ensureClickHouseSchema() {
  if (schemaReady) return;
  const ch = getClickHouse();
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS metrics_entity
      (
        repo_id UUID,
        commit_sha String,
        topo_index UInt32,
        authored_at DateTime64(3, 'UTC'),
        entity_id UUID,
        entity_kind LowCardinality(String),
        metric LowCardinality(String),
        value Float64
      )
      ENGINE = ReplacingMergeTree
      ORDER BY (repo_id, metric, entity_id, topo_index, commit_sha)
    `,
  });
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS metrics_repo
      (
        repo_id UUID,
        commit_sha String,
        topo_index UInt32,
        authored_at DateTime64(3, 'UTC'),
        metric LowCardinality(String),
        value Float64
      )
      ENGINE = ReplacingMergeTree
      ORDER BY (repo_id, metric, topo_index, commit_sha)
    `,
  });
  schemaReady = true;
}

function authoredAtIso(v: string | null | undefined): string {
  if (!v) return '1970-01-01 00:00:00.000';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '1970-01-01 00:00:00.000';
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

/** Idempotent write: delete commit shard then insert (ReplacingMergeTree fallback). */
export async function writeMetricRows(rows: MetricRow[]) {
  if (!rows.length) return { inserted: 0 };
  await ensureClickHouseSchema();
  const ch = getClickHouse();
  const bySha = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const key = `${r.repoId}:${r.commitSha}`;
    const list = bySha.get(key) ?? [];
    list.push(r);
    bySha.set(key, list);
  }

  for (const group of bySha.values()) {
    const repoId = group[0]!.repoId;
    const sha = group[0]!.commitSha;
    await ch.command({
      query: `ALTER TABLE metrics_entity DELETE WHERE repo_id = {repoId:UUID} AND commit_sha = {sha:String}`,
      query_params: { repoId, sha },
    });
    await ch.command({
      query: `ALTER TABLE metrics_repo DELETE WHERE repo_id = {repoId:UUID} AND commit_sha = {sha:String}`,
      query_params: { repoId, sha },
    });

    const entityRows = group.filter((r) => r.entityKind !== 'repo');
    const repoRows = group.filter((r) => r.entityKind === 'repo');

    if (entityRows.length) {
      await ch.insert({
        table: 'metrics_entity',
        values: entityRows.map((r) => ({
          repo_id: r.repoId,
          commit_sha: r.commitSha,
          topo_index: r.topoIndex,
          authored_at: authoredAtIso(r.authoredAt),
          entity_id: r.entityId,
          entity_kind: r.entityKind,
          metric: r.metric,
          value: r.value,
        })),
        format: 'JSONEachRow',
      });
    }
    if (repoRows.length) {
      await ch.insert({
        table: 'metrics_repo',
        values: repoRows.map((r) => ({
          repo_id: r.repoId,
          commit_sha: r.commitSha,
          topo_index: r.topoIndex,
          authored_at: authoredAtIso(r.authoredAt),
          metric: r.metric,
          value: r.value,
        })),
        format: 'JSONEachRow',
      });
    }
  }

  return { inserted: rows.length };
}

export type MetricSeriesPoint = {
  commitSha: string;
  topoIndex: number;
  authoredAt: string | null;
  value: number;
};

export async function queryMetricSeries(opts: {
  repoId: string;
  names: string[];
  entityId?: string;
  fromTopo?: number;
  toTopo?: number;
}): Promise<Array<{ metric: string; entityId: string; points: MetricSeriesPoint[] }>> {
  await ensureClickHouseSchema();
  const ch = getClickHouse();
  const conditions = [`repo_id = {repoId:UUID}`, `metric IN ({names:Array(String)})`];
  const params: Record<string, unknown> = {
    repoId: opts.repoId,
    names: opts.names,
  };
  if (opts.entityId) {
    conditions.push(`entity_id = {entityId:UUID}`);
    params.entityId = opts.entityId;
  }
  if (opts.fromTopo != null) {
    conditions.push(`topo_index >= {fromTopo:UInt32}`);
    params.fromTopo = opts.fromTopo;
  }
  if (opts.toTopo != null) {
    conditions.push(`topo_index <= {toTopo:UInt32}`);
    params.toTopo = opts.toTopo;
  }

  const result = await ch.query({
    query: `
      SELECT metric, entity_id, commit_sha, topo_index, authored_at, value
      FROM metrics_entity FINAL
      WHERE ${conditions.join(' AND ')}
      ORDER BY metric, entity_id, topo_index
    `,
    query_params: params,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as Array<{
    metric: string;
    entity_id: string;
    commit_sha: string;
    topo_index: number;
    authored_at: string;
    value: number;
  }>;

  const grouped = new Map<string, MetricSeriesPoint[]>();
  for (const r of rows) {
    const key = `${r.metric}\0${r.entity_id}`;
    const list = grouped.get(key) ?? [];
    list.push({
      commitSha: r.commit_sha,
      topoIndex: r.topo_index,
      authoredAt: r.authored_at || null,
      value: r.value,
    });
    grouped.set(key, list);
  }

  return [...grouped.entries()].map(([key, points]) => {
    const [metric, entityId] = key.split('\0');
    return { metric: metric!, entityId: entityId!, points };
  });
}

export async function queryHeatmap(opts: {
  repoId: string;
  sha: string;
  metric: string;
  view: 'package' | 'file';
}): Promise<Array<{ entityId: string; value: number }>> {
  await ensureClickHouseSchema();
  const ch = getClickHouse();
  const kind = opts.view === 'package' ? 'package' : 'file';
  const result = await ch.query({
    query: `
      SELECT entity_id, value
      FROM metrics_entity FINAL
      WHERE repo_id = {repoId:UUID}
        AND commit_sha = {sha:String}
        AND metric = {metric:String}
        AND entity_kind = {kind:String}
    `,
    query_params: {
      repoId: opts.repoId,
      sha: opts.sha,
      metric: opts.metric,
      kind,
    },
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as Array<{ entity_id: string; value: number }>;
  return rows.map((r) => ({ entityId: r.entity_id, value: r.value }));
}

export async function querySummary(opts: {
  repoId: string;
  sha: string;
}): Promise<{
  sha: string;
  cycleCount: number;
  packageCount: number;
  fileCount: number;
  avgFanIn: number;
  avgComplexity: number;
  totalLoc: number;
}> {
  await ensureClickHouseSchema();
  const ch = getClickHouse();

  const repoResult = await ch.query({
    query: `
      SELECT metric, value FROM metrics_repo FINAL
      WHERE repo_id = {repoId:UUID} AND commit_sha = {sha:String}
    `,
    query_params: { repoId: opts.repoId, sha: opts.sha },
    format: 'JSONEachRow',
  });
  const repoRows = (await repoResult.json()) as Array<{ metric: string; value: number }>;
  const cycleCount = repoRows.find((r) => r.metric === 'cycle_count')?.value ?? 0;

  const aggResult = await ch.query({
    query: `
      SELECT
        countDistinctIf(entity_id, entity_kind = 'package') AS package_count,
        countDistinctIf(entity_id, entity_kind = 'file') AS file_count,
        avgIf(value, metric = 'fan_in' AND entity_kind = 'package') AS avg_fan_in,
        avgIf(value, metric = 'complexity_proxy') AS avg_complexity,
        sumIf(value, metric = 'loc') AS total_loc
      FROM metrics_entity FINAL
      WHERE repo_id = {repoId:UUID} AND commit_sha = {sha:String}
    `,
    query_params: { repoId: opts.repoId, sha: opts.sha },
    format: 'JSONEachRow',
  });
  const agg = ((await aggResult.json()) as Array<{
    package_count: string | number;
    file_count: string | number;
    avg_fan_in: number;
    avg_complexity: number;
    total_loc: number;
  }>)[0];

  return {
    sha: opts.sha,
    cycleCount,
    packageCount: Number(agg?.package_count ?? 0),
    fileCount: Number(agg?.file_count ?? 0),
    avgFanIn: Number(agg?.avg_fan_in ?? 0),
    avgComplexity: Number(agg?.avg_complexity ?? 0),
    totalLoc: Number(agg?.total_loc ?? 0),
  };
}

export async function queryMetricDelta(opts: {
  repoId: string;
  fromSha: string;
  toSha: string;
  metric?: string;
  limit?: number;
}): Promise<
  Array<{
    entityId: string;
    entityKind: string;
    metric: string;
    fromValue: number;
    toValue: number;
    delta: number;
  }>
> {
  await ensureClickHouseSchema();
  const ch = getClickHouse();
  const metricFilter = opts.metric
    ? `AND metric = {metric:String}`
    : `AND metric IN ('fan_in','fan_out','complexity_proxy','loc','cycle_member')`;
  const result = await ch.query({
    query: `
      SELECT
        a.entity_id AS entity_id,
        a.entity_kind AS entity_kind,
        a.metric AS metric,
        a.value AS from_value,
        b.value AS to_value,
        (b.value - a.value) AS delta
      FROM metrics_entity AS a FINAL
      INNER JOIN metrics_entity AS b FINAL
        ON a.repo_id = b.repo_id
       AND a.entity_id = b.entity_id
       AND a.metric = b.metric
      WHERE a.repo_id = {repoId:UUID}
        AND a.commit_sha = {fromSha:String}
        AND b.commit_sha = {toSha:String}
        ${metricFilter}
      ORDER BY abs(b.value - a.value) DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      repoId: opts.repoId,
      fromSha: opts.fromSha,
      toSha: opts.toSha,
      metric: opts.metric ?? '',
      limit: opts.limit ?? 50,
    },
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as Array<{
    entity_id: string;
    entity_kind: string;
    metric: string;
    from_value: number;
    to_value: number;
    delta: number;
  }>;
  return rows.map((r) => ({
    entityId: r.entity_id,
    entityKind: r.entity_kind,
    metric: r.metric,
    fromValue: r.from_value,
    toValue: r.to_value,
    delta: r.delta,
  }));
}

export async function queryTopMetrics(opts: {
  repoId: string;
  sha: string;
  metric: string;
  view: 'package' | 'file';
  limit?: number;
}): Promise<Array<{ entityId: string; value: number }>> {
  await ensureClickHouseSchema();
  const ch = getClickHouse();
  const result = await ch.query({
    query: `
      SELECT entity_id, value
      FROM metrics_entity FINAL
      WHERE repo_id = {repoId:UUID}
        AND commit_sha = {sha:String}
        AND metric = {metric:String}
        AND entity_kind = {kind:String}
      ORDER BY value DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      repoId: opts.repoId,
      sha: opts.sha,
      metric: opts.metric,
      kind: opts.view === 'package' ? 'package' : 'file',
      limit: opts.limit ?? 20,
    },
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as Array<{ entity_id: string; value: number }>;
  return rows.map((r) => ({ entityId: r.entity_id, value: r.value }));
}

export async function queryCycleMembers(opts: {
  repoId: string;
  sha: string;
}): Promise<Array<{ entityId: string; value: number }>> {
  return queryHeatmap({
    repoId: opts.repoId,
    sha: opts.sha,
    metric: 'cycle_member',
    view: 'package',
  }).then((rows) => rows.filter((r) => r.value > 0));
}
