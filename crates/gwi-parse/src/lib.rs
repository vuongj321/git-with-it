//! Public library API for parsing source files / directories.

mod detect;
mod fqn;
mod model;
mod python;
mod typescript;
mod util;

pub use detect::{detect_language, guess_package, is_source_file, relative_path};
pub use fqn::*;
pub use model::*;

use anyhow::{Context, Result};
use std::path::Path;
use walkdir::WalkDir;

fn read_text(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    // Strip UTF-8 BOM (common on Windows editors)
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec()).with_context(|| format!("utf-8 {}", path.display()))
}

pub fn parse_file(root: Option<&Path>, path: &Path) -> Result<FileParseResult> {
    let source = read_text(path)?;
    let language = detect_language(path)
        .with_context(|| format!("unsupported language for {}", path.display()))?;
    let rel = root
        .map(|r| relative_path(r, path))
        .unwrap_or_else(|| path.to_string_lossy().replace('\\', "/"));
    let package = root.and_then(|r| guess_package(r, path));

    match language {
        Language::Typescript | Language::Javascript => {
            typescript::extract_typescript(&rel, &source, language, package)
        }
        Language::Python => python::extract_python(&rel, &source, package),
    }
}

pub fn parse_source_str(
    path: &str,
    source: &str,
    language: Language,
    package: Option<String>,
) -> Result<FileParseResult> {
    match language {
        Language::Typescript | Language::Javascript => {
            typescript::extract_typescript(path, source, language, package)
        }
        Language::Python => python::extract_python(path, source, package),
    }
}

/// Walk `root` and parse all supported source files. Emits one `FileParseResult` per file.
pub fn parse_dir(root: &Path) -> Result<Vec<FileParseResult>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        // skip common noise
        let rel = relative_path(root, path);
        if rel.split('/').any(|p| {
            matches!(
                p,
                "node_modules" | ".git" | "dist" | "build" | "__pycache__" | ".venv" | "target"
            )
        }) {
            continue;
        }
        if !is_source_file(path) {
            continue;
        }
        out.push(parse_file(Some(root), path)?);
    }
    out.sort_by(|a, b| a.file.path.cmp(&b.file.path));
    Ok(out)
}

/// Also emit a package symbol when a package.json / pyproject is found at root.
pub fn collect_package_symbols(root: &Path) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let pkg_json = root.join("package.json");
    if pkg_json.is_file() {
        if let Ok(text) = read_text(&pkg_json) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                    symbols.push(Symbol {
                        kind: SymbolKind::Package,
                        name: name.to_string(),
                        fqn: name.to_string(),
                        span: Span {
                            start_line: 1,
                            start_col: 0,
                            end_line: 1,
                            end_col: 0,
                        },
                        export: true,
                    });
                }
            }
        }
    }
    let pyproject = root.join("pyproject.toml");
    if pyproject.is_file() {
        if let Ok(text) = read_text(&pyproject) {
            // minimal: name = "foo" under [project]
            for line in text.lines() {
                let t = line.trim();
                if let Some(rest) = t.strip_prefix("name") {
                    let rest = rest.trim().trim_start_matches('=').trim();
                    let name = rest.trim_matches('"').trim_matches('\'');
                    if !name.is_empty() && !name.contains('[') {
                        symbols.push(Symbol {
                            kind: SymbolKind::Package,
                            name: name.to_string(),
                            fqn: name.to_string(),
                            span: Span {
                                start_line: 1,
                                start_col: 0,
                                end_line: 1,
                                end_col: 0,
                            },
                            export: true,
                        });
                        break;
                    }
                }
            }
        }
    }
    symbols
}
