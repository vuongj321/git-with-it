//! Compute architectural metrics from a GraphSnapshot JSON (Phase 3).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub fqn: String,
    pub name: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub package: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub rel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSnapshot {
    #[serde(alias = "repoId")]
    pub repo_id: Option<String>,
    pub sha: String,
    #[serde(default, alias = "analyzerVersion")]
    pub analyzer_version: Option<String>,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileStat {
    #[serde(default)]
    pub loc: Option<f64>,
    #[serde(default, rename = "complexityProxy")]
    pub complexity_proxy: Option<f64>,
    #[serde(default)]
    pub churn: Option<f64>,
    #[serde(default, rename = "fileSize")]
    pub file_size: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRow {
    pub repo_id: String,
    pub commit_sha: String,
    pub topo_index: u32,
    pub authored_at: Option<String>,
    pub entity_id: String,
    pub entity_kind: String,
    pub metric: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsRequest {
    pub repo_id: String,
    pub snapshot: GraphSnapshot,
    pub topo_index: u32,
    #[serde(default)]
    pub authored_at: Option<String>,
    #[serde(default)]
    pub file_stats: HashMap<String, FileStat>,
}

fn find_sccs(edges: &[GraphEdge], node_ids: &[String]) -> Vec<Vec<String>> {
    let mut nodes: HashSet<String> = node_ids.iter().cloned().collect();
    for e in edges {
        nodes.insert(e.from.clone());
        nodes.insert(e.to.clone());
    }
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for id in &nodes {
        adj.insert(id.clone(), Vec::new());
    }
    for e in edges {
        if e.rel != "DEPENDS_ON" && e.rel != "IMPORTS" {
            continue;
        }
        adj.entry(e.from.clone()).or_default().push(e.to.clone());
    }

    let mut index = 0usize;
    let mut indices: HashMap<String, usize> = HashMap::new();
    let mut lowlink: HashMap<String, usize> = HashMap::new();
    let mut on_stack: HashSet<String> = HashSet::new();
    let mut stack: Vec<String> = Vec::new();
    let mut sccs: Vec<Vec<String>> = Vec::new();

    fn strongconnect(
        v: &str,
        adj: &HashMap<String, Vec<String>>,
        index: &mut usize,
        indices: &mut HashMap<String, usize>,
        lowlink: &mut HashMap<String, usize>,
        on_stack: &mut HashSet<String>,
        stack: &mut Vec<String>,
        sccs: &mut Vec<Vec<String>>,
    ) {
        indices.insert(v.to_string(), *index);
        lowlink.insert(v.to_string(), *index);
        *index += 1;
        stack.push(v.to_string());
        on_stack.insert(v.to_string());

        if let Some(neighbors) = adj.get(v) {
            for w in neighbors {
                if !indices.contains_key(w) {
                    strongconnect(w, adj, index, indices, lowlink, on_stack, stack, sccs);
                    let lw = *lowlink.get(w).unwrap();
                    let lv = *lowlink.get(v).unwrap();
                    lowlink.insert(v.to_string(), lv.min(lw));
                } else if on_stack.contains(w) {
                    let iw = *indices.get(w).unwrap();
                    let lv = *lowlink.get(v).unwrap();
                    lowlink.insert(v.to_string(), lv.min(iw));
                }
            }
        }

        if lowlink.get(v) == indices.get(v) {
            let mut comp = Vec::new();
            loop {
                let w = stack.pop().unwrap();
                on_stack.remove(&w);
                comp.push(w.clone());
                if w == v {
                    break;
                }
            }
            if comp.len() >= 2 {
                comp.sort();
                sccs.push(comp);
            }
        }
    }

    for v in &nodes {
        if !indices.contains_key(v) {
            strongconnect(
                v,
                &adj,
                &mut index,
                &mut indices,
                &mut lowlink,
                &mut on_stack,
                &mut stack,
                &mut sccs,
            );
        }
    }
    sccs
}

fn degree_maps(edges: &[GraphEdge]) -> (HashMap<String, f64>, HashMap<String, f64>) {
    let mut fan_in = HashMap::new();
    let mut fan_out = HashMap::new();
    for e in edges {
        if e.rel != "DEPENDS_ON" && e.rel != "IMPORTS" {
            continue;
        }
        *fan_out.entry(e.from.clone()).or_insert(0.0) += 1.0;
        *fan_in.entry(e.to.clone()).or_insert(0.0) += 1.0;
    }
    (fan_in, fan_out)
}

fn dependency_count(edges: &[GraphEdge], from: &str) -> f64 {
    let mut targets = HashSet::new();
    for e in edges {
        if e.from != from {
            continue;
        }
        if e.rel != "DEPENDS_ON" && e.rel != "IMPORTS" {
            continue;
        }
        targets.insert(e.to.clone());
    }
    targets.len() as f64
}

/// Entity key used when UUID mapping is deferred to the worker/API (`kind:fqn`).
fn entity_key(kind: &str, fqn: &str) -> String {
    format!("{kind}:{fqn}")
}

pub fn compute_metrics(req: &MetricsRequest) -> Vec<MetricRow> {
    let snap = &req.snapshot;
    let package_nodes: Vec<_> = snap.nodes.iter().filter(|n| n.kind == "package").collect();
    let file_nodes: Vec<_> = snap.nodes.iter().filter(|n| n.kind == "file").collect();
    let pkg_ids: Vec<String> = package_nodes.iter().map(|n| n.id.clone()).collect();

    let cycle_nodes: Vec<String> = if pkg_ids.is_empty() {
        snap.nodes.iter().map(|n| n.id.clone()).collect()
    } else {
        pkg_ids.clone()
    };
    let sccs = find_sccs(&snap.edges, &cycle_nodes);

    let mut cycle_member: HashMap<String, f64> = HashMap::new();
    for (idx, scc) in sccs.iter().enumerate() {
        for id in scc {
            if pkg_ids.is_empty() || pkg_ids.contains(id) {
                cycle_member.insert(id.clone(), (idx + 1) as f64);
            }
        }
    }

    let (pkg_fan_in, pkg_fan_out) = degree_maps(&snap.edges);
    let (file_fan_in, file_fan_out) = degree_maps(&snap.edges);

    let mut rows = Vec::new();
    let push = |rows: &mut Vec<MetricRow>,
                entity_id: String,
                entity_kind: &str,
                metric: &str,
                value: f64| {
        rows.push(MetricRow {
            repo_id: req.repo_id.clone(),
            commit_sha: snap.sha.clone(),
            topo_index: req.topo_index,
            authored_at: req.authored_at.clone(),
            entity_id,
            entity_kind: entity_kind.to_string(),
            metric: metric.to_string(),
            value,
        });
    };

    push(
        &mut rows,
        req.repo_id.clone(),
        "repo",
        "cycle_count",
        sccs.len() as f64,
    );

    for n in &package_nodes {
        let eid = entity_key("package", &n.fqn);
        push(
            &mut rows,
            eid.clone(),
            "package",
            "fan_in",
            *pkg_fan_in.get(&n.id).unwrap_or(&0.0),
        );
        push(
            &mut rows,
            eid.clone(),
            "package",
            "fan_out",
            *pkg_fan_out.get(&n.id).unwrap_or(&0.0),
        );
        push(
            &mut rows,
            eid.clone(),
            "package",
            "dependency_count",
            dependency_count(&snap.edges, &n.id),
        );
        push(
            &mut rows,
            eid,
            "package",
            "cycle_member",
            if cycle_member.contains_key(&n.id) {
                1.0
            } else {
                0.0
            },
        );
    }

    let mut max_complexity = 1.0_f64;
    let mut max_fan_in = 1.0_f64;
    let mut max_loc = 1.0_f64;
    let mut metas = Vec::new();
    for n in &file_nodes {
        let path = n.path.clone().unwrap_or_else(|| n.fqn.clone());
        let stats = req.file_stats.get(&path).cloned().unwrap_or_default();
        let loc = stats.loc.unwrap_or(0.0);
        let complexity = stats.complexity_proxy.unwrap_or(0.0);
        let fi = *file_fan_in.get(&n.id).unwrap_or(&0.0);
        max_complexity = max_complexity.max(complexity);
        max_fan_in = max_fan_in.max(fi);
        max_loc = max_loc.max(loc);
        metas.push((n, path, stats, loc, complexity, fi));
    }

    for (n, _path, stats, loc, complexity, fi) in metas {
        let eid = entity_key("file", &n.fqn);
        let fo = *file_fan_out.get(&n.id).unwrap_or(&0.0);
        push(&mut rows, eid.clone(), "file", "fan_in", fi);
        push(&mut rows, eid.clone(), "file", "fan_out", fo);
        push(&mut rows, eid.clone(), "file", "loc", loc);
        if let Some(sz) = stats.file_size {
            push(&mut rows, eid.clone(), "file", "file_size", sz);
        }
        push(&mut rows, eid.clone(), "file", "complexity_proxy", complexity);
        if let Some(ch) = stats.churn {
            push(&mut rows, eid.clone(), "file", "churn", ch);
        }
        let c_n = if max_complexity > 0.0 {
            complexity / max_complexity
        } else {
            0.0
        };
        let fi_n = if max_fan_in > 0.0 { fi / max_fan_in } else { 0.0 };
        let loc_n = if max_loc > 0.0 { loc / max_loc } else { 0.0 };
        let burden = 0.4 * c_n + 0.3 * fi_n + 0.3 * loc_n;
        let maint = (100.0 - (burden * 100.0)).clamp(0.0, 100.0);
        push(&mut rows, eid, "file", "maintainability_proxy", maint);
    }

    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cycle_count_on_two_node_cycle() {
        let snap = GraphSnapshot {
            repo_id: Some("r1".into()),
            sha: "bbb2222".into(),
            analyzer_version: Some("0.1.0".into()),
            nodes: vec![
                GraphNode {
                    id: "pkg:a".into(),
                    kind: "package".into(),
                    fqn: "a".into(),
                    name: "a".into(),
                    path: None,
                    language: None,
                    package: Some("a".into()),
                },
                GraphNode {
                    id: "pkg:b".into(),
                    kind: "package".into(),
                    fqn: "b".into(),
                    name: "b".into(),
                    path: None,
                    language: None,
                    package: Some("b".into()),
                },
            ],
            edges: vec![
                GraphEdge {
                    from: "pkg:a".into(),
                    to: "pkg:b".into(),
                    rel: "DEPENDS_ON".into(),
                },
                GraphEdge {
                    from: "pkg:b".into(),
                    to: "pkg:a".into(),
                    rel: "DEPENDS_ON".into(),
                },
            ],
        };
        let rows = compute_metrics(&MetricsRequest {
            repo_id: "11111111-1111-1111-1111-111111111111".into(),
            snapshot: snap,
            topo_index: 1,
            authored_at: None,
            file_stats: HashMap::new(),
        });
        let cycle = rows
            .iter()
            .find(|r| r.metric == "cycle_count")
            .expect("cycle_count");
        assert_eq!(cycle.value, 1.0);
    }
}
