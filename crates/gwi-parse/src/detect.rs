//! Package / language detection heuristics.

use crate::model::Language;
use std::path::{Path, PathBuf};

pub fn detect_language(path: &Path) -> Option<Language> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "ts" | "mts" | "cts" => Some(Language::Typescript),
        "tsx" => Some(Language::Typescript),
        "js" | "mjs" | "cjs" | "jsx" => Some(Language::Javascript),
        "py" | "pyi" => Some(Language::Python),
        "go" => Some(Language::Go),
        "java" => Some(Language::Java),
        _ => None,
    }
}

pub fn is_source_file(path: &Path) -> bool {
    detect_language(path).is_some()
}

/// Walk up from `file` toward `root` looking for nearest `package.json` name or Python package root.
pub fn guess_package(root: &Path, file: &Path) -> Option<String> {
    let lang = detect_language(file)?;
    match lang {
        Language::Typescript | Language::Javascript => nearest_npm_package(root, file),
        Language::Python => nearest_python_package(root, file),
        Language::Go => nearest_go_module(root, file),
        Language::Java => nearest_java_package(root, file),
    }
}

fn nearest_npm_package(root: &Path, file: &Path) -> Option<String> {
    let mut dir = file.parent()?.to_path_buf();
    loop {
        let pkg = dir.join("package.json");
        if pkg.is_file() {
            if let Ok(mut bytes) = std::fs::read(&pkg) {
                if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
                    bytes.drain(..3);
                }
                if let Ok(text) = String::from_utf8(bytes) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                            return Some(name.to_string());
                        }
                    }
                }
            }
            return Some(dir.file_name()?.to_string_lossy().into_owned());
        }
        if dir == root || !dir.starts_with(root) {
            break;
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn nearest_python_package(root: &Path, file: &Path) -> Option<String> {
    // Prefer directory containing pyproject.toml / setup.py; else dotted path from root.
    let mut dir = file.parent()?.to_path_buf();
    let mut found_root: Option<PathBuf> = None;
    loop {
        if dir.join("pyproject.toml").is_file()
            || dir.join("setup.py").is_file()
            || dir.join("setup.cfg").is_file()
        {
            found_root = Some(dir.clone());
            break;
        }
        if dir == root || !dir.starts_with(root) {
            break;
        }
        if !dir.pop() {
            break;
        }
    }
    let base = found_root.unwrap_or_else(|| root.to_path_buf());
    let rel = file.strip_prefix(&base).ok()?;
    let module = crate::fqn::python_module_path(&rel.to_string_lossy());
    if module.is_empty() {
        None
    } else {
        // package = top-level segment
        Some(module.split('.').next()?.to_string())
    }
}

fn nearest_go_module(root: &Path, file: &Path) -> Option<String> {
    let mut dir = file.parent()?.to_path_buf();
    loop {
        let gomod = dir.join("go.mod");
        if gomod.is_file() {
            if let Ok(text) = std::fs::read_to_string(&gomod) {
                for line in text.lines() {
                    let t = line.trim();
                    if let Some(rest) = t.strip_prefix("module ") {
                        let module = rest.trim();
                        if !module.is_empty() {
                            return Some(module.to_string());
                        }
                    }
                }
            }
            return dir.file_name().map(|n| n.to_string_lossy().into_owned());
        }
        if dir == root || !dir.starts_with(root) {
            break;
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn nearest_java_package(root: &Path, file: &Path) -> Option<String> {
    // Prefer Maven/Gradle roots: src/main/java/... → dotted package from that root.
    let rel = relative_path(root, file);
    for marker in ["src/main/java/", "src/test/java/"] {
        if let Some(idx) = rel.find(marker) {
            let rest = &rel[idx + marker.len()..];
            let dir = rest.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
            if !dir.is_empty() {
                return Some(dir.replace('/', "."));
            }
        }
    }
    // Heuristic: walk up for pom.xml / build.gradle then use path under src/
    let mut dir = file.parent()?.to_path_buf();
    let mut build_root: Option<PathBuf> = None;
    loop {
        if dir.join("pom.xml").is_file()
            || dir.join("build.gradle").is_file()
            || dir.join("build.gradle.kts").is_file()
        {
            build_root = Some(dir.clone());
            break;
        }
        if dir == root || !dir.starts_with(root) {
            break;
        }
        if !dir.pop() {
            break;
        }
    }
    let base = build_root.unwrap_or_else(|| root.to_path_buf());
    let rel = relative_path(&base, file);
    for marker in ["src/main/java/", "src/test/java/", "src/"] {
        if let Some(rest) = rel.strip_prefix(marker) {
            let dir = rest.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
            if !dir.is_empty() {
                return Some(dir.replace('/', "."));
            }
        }
    }
    let parent = file.parent()?;
    let rel = relative_path(root, parent);
    if rel.is_empty() {
        None
    } else {
        Some(rel.replace('/', "."))
    }
}

pub fn relative_path(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .replace('\\', "/")
}
