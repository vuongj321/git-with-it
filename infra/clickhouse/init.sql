CREATE DATABASE IF NOT EXISTS gwi;

CREATE TABLE IF NOT EXISTS gwi.metrics_entity
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
PARTITION BY repo_id
ORDER BY (repo_id, metric, entity_id, topo_index, commit_sha);

CREATE TABLE IF NOT EXISTS gwi.metrics_repo
(
  repo_id UUID,
  commit_sha String,
  topo_index UInt32,
  authored_at DateTime64(3, 'UTC'),
  metric LowCardinality(String),
  value Float64
)
ENGINE = ReplacingMergeTree
PARTITION BY repo_id
ORDER BY (repo_id, metric, topo_index, commit_sha);
