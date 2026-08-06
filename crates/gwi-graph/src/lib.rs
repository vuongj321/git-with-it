//! Build a single-SHA package/file adjacency graph from linked parse results.

use gwi_link::LinkedFile;
use gwi_parse::{RefKind, SymbolKind};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub fqn: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    /// CONTAINS | IMPORTS | DEPENDS_ON
    pub rel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphSnapshot {
    pub repo_id: String,
    pub sha: String,
    pub analyzer_version: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

pub struct GraphBuilder {
    pub repo_id: String,
    pub sha: String,
    pub analyzer_version: String,
    /// Include exported class/function nodes (default true)
    pub include_symbols: bool,
}

impl GraphBuilder {
    pub fn build(&self, linked: &[LinkedFile]) -> GraphSnapshot {
        let mut nodes: HashMap<String, GraphNode> = HashMap::new();
        let mut edges: HashSet<GraphEdge> = HashSet::new();

        // Package nodes
        for f in linked {
            if let Some(pkg) = &f.file.package {
                let id = format!("pkg:{pkg}");
                nodes.entry(id.clone()).or_insert(GraphNode {
                    id: id.clone(),
                    kind: "package".into(),
                    fqn: pkg.clone(),
                    name: pkg.clone(),
                    path: None,
                    language: Some(f.file.language.as_str().into()),
                    package: Some(pkg.clone()),
                });
            }
        }

        for f in linked {
            let file_id = format!("file:{}", f.file.path);
            nodes.insert(
                file_id.clone(),
                GraphNode {
                    id: file_id.clone(),
                    kind: "file".into(),
                    fqn: f
                        .symbols
                        .iter()
                        .find(|s| s.kind == SymbolKind::File)
                        .map(|s| s.fqn.clone())
                        .unwrap_or_else(|| f.file.path.clone()),
                    name: f.file.path.rsplit('/').next().unwrap_or(&f.file.path).into(),
                    path: Some(f.file.path.clone()),
                    language: Some(f.file.language.as_str().into()),
                    package: f.file.package.clone(),
                },
            );

            if let Some(pkg) = &f.file.package {
                let pkg_id = format!("pkg:{pkg}");
                edges.insert(GraphEdge {
                    from: pkg_id,
                    to: file_id.clone(),
                    rel: "CONTAINS".into(),
                });
            }

            if self.include_symbols {
                for s in &f.symbols {
                    if !matches!(
                        s.kind,
                        SymbolKind::Class
                            | SymbolKind::Interface
                            | SymbolKind::Function
                            | SymbolKind::Method
                    ) {
                        continue;
                    }
                    if !s.export {
                        continue;
                    }
                    let sid = format!("sym:{}", s.fqn);
                    nodes.insert(
                        sid.clone(),
                        GraphNode {
                            id: sid.clone(),
                            kind: format!("{:?}", s.kind).to_ascii_lowercase(),
                            fqn: s.fqn.clone(),
                            name: s.name.clone(),
                            path: Some(f.file.path.clone()),
                            language: Some(f.file.language.as_str().into()),
                            package: f.file.package.clone(),
                        },
                    );
                    edges.insert(GraphEdge {
                        from: file_id.clone(),
                        to: sid,
                        rel: "CONTAINS".into(),
                    });
                }
            }

            for r in &f.refs {
                if r.kind != RefKind::Import || !r.resolved {
                    continue;
                }
                let Some(target_path) = &r.target_path else {
                    continue;
                };
                let to_id = format!("file:{target_path}");
                edges.insert(GraphEdge {
                    from: file_id.clone(),
                    to: to_id.clone(),
                    rel: "IMPORTS".into(),
                });
                edges.insert(GraphEdge {
                    from: file_id.clone(),
                    to: to_id,
                    rel: "DEPENDS_ON".into(),
                });

                // Package-level DEPENDS_ON
                if let (Some(from_pkg), Some(to_file)) =
                    (&f.file.package, linked.iter().find(|x| x.file.path == *target_path))
                {
                    if let Some(to_pkg) = &to_file.file.package {
                        if from_pkg != to_pkg {
                            edges.insert(GraphEdge {
                                from: format!("pkg:{from_pkg}"),
                                to: format!("pkg:{to_pkg}"),
                                rel: "DEPENDS_ON".into(),
                            });
                        }
                    }
                }
            }
        }

        let mut node_list: Vec<_> = nodes.into_values().collect();
        node_list.sort_by(|a, b| a.id.cmp(&b.id));
        let mut edge_list: Vec<_> = edges.into_iter().collect();
        edge_list.sort_by(|a, b| (&a.from, &a.rel, &a.to).cmp(&(&b.from, &b.rel, &b.to)));

        GraphSnapshot {
            repo_id: self.repo_id.clone(),
            sha: self.sha.clone(),
            analyzer_version: self.analyzer_version.clone(),
            nodes: node_list,
            edges: edge_list,
        }
    }
}

/// Cap a package-view slice for API responses.
pub fn package_view(snapshot: &GraphSnapshot, max_nodes: usize) -> GraphSnapshot {
    let pkg_ids: HashSet<_> = snapshot
        .nodes
        .iter()
        .filter(|n| n.kind == "package")
        .map(|n| n.id.clone())
        .take(max_nodes)
        .collect();
    let nodes: Vec<_> = snapshot
        .nodes
        .iter()
        .filter(|n| pkg_ids.contains(&n.id))
        .cloned()
        .collect();
    let edges: Vec<_> = snapshot
        .edges
        .iter()
        .filter(|e| pkg_ids.contains(&e.from) && pkg_ids.contains(&e.to))
        .cloned()
        .collect();
    GraphSnapshot {
        repo_id: snapshot.repo_id.clone(),
        sha: snapshot.sha.clone(),
        analyzer_version: snapshot.analyzer_version.clone(),
        nodes,
        edges,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gwi_link::LinkContext;
    use gwi_parse::parse_dir;
    use std::path::PathBuf;

    #[test]
    fn ts_mini_has_import_edge() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/repos/ts-mini");
        let parses = parse_dir(&root).unwrap();
        let linked = LinkContext::from_parses(parses).link_all();
        let snap = GraphBuilder {
            repo_id: "00000000-0000-0000-0000-000000000001".into(),
            sha: "deadbeef".into(),
            analyzer_version: gwi_parse::ANALYZER_VERSION.into(),
            include_symbols: true,
        }
        .build(&linked);
        assert!(snap.edges.iter().any(|e| {
            e.rel == "IMPORTS"
                && e.from == "file:src/checkout.ts"
                && e.to == "file:src/payments.ts"
        }));
        assert!(snap.nodes.iter().any(|n| n.kind == "package"));
    }
}
