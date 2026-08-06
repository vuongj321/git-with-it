//! Resolve unresolved import refs to file / symbol FQNs.

use anyhow::{Context, Result};
use gwi_parse::{FileParseResult, RefKind, UnresolvedRef};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolvedRef {
    pub kind: RefKind,
    pub raw: String,
    /// Target file path (normalized) when resolved
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    /// Target FQN when resolved to a symbol or file
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_fqn: Option<String>,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkedFile {
    pub file: gwi_parse::FileFacts,
    pub symbols: Vec<gwi_parse::Symbol>,
    pub refs: Vec<ResolvedRef>,
}

#[derive(Debug, Clone, Default)]
pub struct LinkContext {
    /// path → FileParseResult
    pub files: HashMap<String, FileParseResult>,
    /// tsconfig paths: alias prefix → target prefix (relative to root)
    pub path_aliases: Vec<(String, String)>,
}

impl LinkContext {
    pub fn from_parses(parses: Vec<FileParseResult>) -> Self {
        let mut files = HashMap::new();
        for p in parses {
            files.insert(p.file.path.clone(), p);
        }
        Self {
            files,
            path_aliases: Vec::new(),
        }
    }

    pub fn with_tsconfig_paths(mut self, root: &Path) -> Self {
        self.path_aliases = read_tsconfig_paths(root).unwrap_or_default();
        self
    }

    pub fn link_all(&self) -> Vec<LinkedFile> {
        let mut out: Vec<_> = self
            .files
            .values()
            .map(|p| self.link_file(p))
            .collect();
        out.sort_by(|a, b| a.file.path.cmp(&b.file.path));
        out
    }

    pub fn link_file(&self, parse: &FileParseResult) -> LinkedFile {
        let refs = parse
            .refs
            .iter()
            .map(|r| self.resolve_ref(&parse.file.path, r))
            .collect();
        LinkedFile {
            file: parse.file.clone(),
            symbols: parse.symbols.clone(),
            refs,
        }
    }

    fn resolve_ref(&self, from_path: &str, r: &UnresolvedRef) -> ResolvedRef {
        if r.kind != RefKind::Import {
            return ResolvedRef {
                kind: r.kind,
                raw: r.raw.clone(),
                target_path: None,
                target_fqn: None,
                resolved: false,
            };
        }

        let lang = self
            .files
            .get(from_path)
            .map(|f| f.file.language)
            .unwrap_or(gwi_parse::Language::Typescript);

        let target = match lang {
            gwi_parse::Language::Python => resolve_python_import(from_path, &r.raw, &self.files),
            _ => resolve_ts_import(from_path, &r.raw, &self.files, &self.path_aliases),
        };

        match target {
            Some(path) => {
                let fqn = self
                    .files
                    .get(&path)
                    .and_then(|f| f.symbols.iter().find(|s| s.kind == gwi_parse::SymbolKind::File))
                    .map(|s| s.fqn.clone())
                    .unwrap_or_else(|| path.clone());
                ResolvedRef {
                    kind: r.kind,
                    raw: r.raw.clone(),
                    target_path: Some(path),
                    target_fqn: Some(fqn),
                    resolved: true,
                }
            }
            None => ResolvedRef {
                kind: r.kind,
                raw: r.raw.clone(),
                target_path: None,
                target_fqn: None,
                resolved: false,
            },
        }
    }
}

fn resolve_ts_import(
    from_path: &str,
    raw: &str,
    files: &HashMap<String, FileParseResult>,
    aliases: &[(String, String)],
) -> Option<String> {
    // Skip bare package imports (node_modules)
    if !raw.starts_with('.') && !raw.starts_with('/') && alias_match(raw, aliases).is_none() {
        return None;
    }

    let mut candidate = if let Some((from, to)) = alias_match(raw, aliases) {
        let rest = raw.strip_prefix(from).unwrap_or(raw);
        format!("{to}{rest}")
    } else {
        join_relative(from_path, raw)
    };

    candidate = gwi_parse::normalize_path(&candidate);
    lookup_ts_module(&candidate, files)
}

fn alias_match<'a>(raw: &str, aliases: &'a [(String, String)]) -> Option<(&'a str, &'a str)> {
    for (from, to) in aliases {
        if raw == from || raw.starts_with(&format!("{from}/")) {
            return Some((from.as_str(), to.as_str()));
        }
    }
    None
}

fn lookup_ts_module(base: &str, files: &HashMap<String, FileParseResult>) -> Option<String> {
    let suffixes = [
        "",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mts",
        ".cts",
        "/index.ts",
        "/index.tsx",
        "/index.js",
    ];
    for suf in suffixes {
        let p = format!("{base}{suf}");
        let p = gwi_parse::normalize_path(&p);
        if files.contains_key(&p) {
            return Some(p);
        }
    }
    None
}

fn resolve_python_import(
    from_path: &str,
    raw: &str,
    files: &HashMap<String, FileParseResult>,
) -> Option<String> {
    // raw may be "payments.service" or "payments.service:PaymentService"
    let module = raw.split(':').next().unwrap_or(raw).trim();
    if module.is_empty() || module == "*" {
        return None;
    }
    // relative: ".service" / "..foo"
    let module_path = if module.starts_with('.') {
        resolve_relative_python(from_path, module)?
    } else {
        module.replace('.', "/")
    };

    let candidates = [
        format!("{module_path}.py"),
        format!("{module_path}/__init__.py"),
    ];
    for c in candidates {
        let c = gwi_parse::normalize_path(&c);
        if files.contains_key(&c) {
            return Some(c);
        }
    }
    None
}

fn resolve_relative_python(from_path: &str, module: &str) -> Option<String> {
    let mut dots = 0usize;
    for c in module.chars() {
        if c == '.' {
            dots += 1;
        } else {
            break;
        }
    }
    let rest = &module[dots..];
    let mut dir = PathBuf::from(from_path);
    dir.pop(); // file → dir
    for _ in 0..dots.saturating_sub(1) {
        dir.pop();
    }
    let mut out = dir;
    if !rest.is_empty() {
        for part in rest.split('.') {
            out.push(part);
        }
    }
    Some(out.to_string_lossy().replace('\\', "/"))
}

fn join_relative(from_path: &str, raw: &str) -> String {
    let mut dir = PathBuf::from(from_path);
    dir.pop();
    let joined = dir.join(raw);
    gwi_parse::normalize_path(&joined.to_string_lossy())
}

/// Minimal tsconfig paths reader: `{ "paths": { "@app/*": ["src/*"] } }`
pub fn read_tsconfig_paths(root: &Path) -> Result<Vec<(String, String)>> {
    let path = root.join("tsconfig.json");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let text = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    // Strip BOM + comments roughly (tsconfig allows comments — strip // lines)
    let cleaned: String = text
        .lines()
        .map(|l| {
            if let Some(idx) = l.find("//") {
                &l[..idx]
            } else {
                l
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let v: serde_json::Value = serde_json::from_str(&cleaned).unwrap_or(serde_json::json!({}));
    let mut out = Vec::new();
    if let Some(paths) = v
        .pointer("/compilerOptions/paths")
        .and_then(|p| p.as_object())
    {
        for (alias, targets) in paths {
            let Some(arr) = targets.as_array() else {
                continue;
            };
            let Some(target) = arr.first().and_then(|t| t.as_str()) else {
                continue;
            };
            let from = alias.trim_end_matches("/*").trim_end_matches('*').to_string();
            let to = target.trim_end_matches("/*").trim_end_matches('*').to_string();
            out.push((from, to));
        }
    }
    Ok(out)
}

pub fn link_parse_jsonl(input: &str, root: Option<&Path>) -> Result<Vec<LinkedFile>> {
    let mut parses = Vec::new();
    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Skip package-only records without file
        if !line.contains("\"file\"") {
            continue;
        }
        let p: FileParseResult = serde_json::from_str(line)
            .with_context(|| format!("parse jsonl line: {}", &line[..line.len().min(80)]))?;
        parses.push(p);
    }
    let mut ctx = LinkContext::from_parses(parses);
    if let Some(root) = root {
        ctx = ctx.with_tsconfig_paths(root);
    }
    Ok(ctx.link_all())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gwi_parse::{parse_dir, Language};

    #[test]
    fn resolves_ts_relative_import() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/repos/ts-mini");
        let parses = parse_dir(&root).unwrap();
        let linked = LinkContext::from_parses(parses).link_all();
        let checkout = linked.iter().find(|f| f.file.path == "src/checkout.ts").unwrap();
        let imp = checkout
            .refs
            .iter()
            .find(|r| r.raw == "./payments")
            .unwrap();
        assert!(imp.resolved);
        assert_eq!(imp.target_path.as_deref(), Some("src/payments.ts"));
    }

    #[test]
    fn resolves_python_from_import() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/repos/py-mini");
        let parses = parse_dir(&root).unwrap();
        let linked = LinkContext::from_parses(parses).link_all();
        let checkout = linked
            .iter()
            .find(|f| f.file.path == "payments/checkout.py")
            .unwrap();
        assert_eq!(checkout.file.language, Language::Python);
        let imp = checkout.refs.iter().find(|r| r.kind == RefKind::Import).unwrap();
        assert!(imp.resolved, "{imp:?}");
        assert_eq!(imp.target_path.as_deref(), Some("payments/service.py"));
    }
}
