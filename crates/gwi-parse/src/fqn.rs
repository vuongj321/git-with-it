//! FQN normalization rules (Phase 1 ADR).
//!
//! - Paths use forward slashes
//! - TypeScript/JavaScript: `path#Symbol` / `path#Class.method`
//! - Python: `module.path.Class.method`

use std::path::{Component, Path};

/// Normalize a repo-relative path to forward-slash form without leading `./`.
pub fn normalize_path(path: &str) -> String {
    let path = path.replace('\\', "/");
    let trimmed = path.trim_start_matches("./");
    Path::new(trimmed)
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// TS/JS file-level FQN (the file entity itself).
pub fn ts_file_fqn(path: &str) -> String {
    normalize_path(path)
}

/// TS/JS top-level symbol: `path#Name`
pub fn ts_symbol_fqn(path: &str, name: &str) -> String {
    format!("{}#{}", normalize_path(path), name)
}

/// TS/JS method: `path#Class.method`
pub fn ts_method_fqn(path: &str, class: &str, method: &str) -> String {
    format!("{}#{}.{}", normalize_path(path), class, method)
}

/// Convert a Python source path to a dotted module path.
/// `payments/service.py` → `payments.service`; `pkg/__init__.py` → `pkg`
pub fn python_module_path(path: &str) -> String {
    let norm = normalize_path(path);
    let without_ext = norm
        .strip_suffix(".py")
        .or_else(|| norm.strip_suffix(".pyi"))
        .unwrap_or(&norm);
    let parts: Vec<&str> = without_ext
        .split('/')
        .filter(|p| !p.is_empty() && *p != "__init__")
        .collect();
    parts.join(".")
}

/// Python class/function: `module.path.Name`
pub fn py_symbol_fqn(module: &str, name: &str) -> String {
    if module.is_empty() {
        name.to_string()
    } else {
        format!("{module}.{name}")
    }
}

/// Python method: `module.path.Class.method`
pub fn py_method_fqn(module: &str, class: &str, method: &str) -> String {
    if module.is_empty() {
        format!("{class}.{method}")
    } else {
        format!("{module}.{class}.{method}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_windows_paths() {
        assert_eq!(normalize_path(r"src\foo\bar.ts"), "src/foo/bar.ts");
        assert_eq!(normalize_path("./src/foo.ts"), "src/foo.ts");
    }

    #[test]
    fn ts_fqns() {
        assert_eq!(
            ts_symbol_fqn("src/pay.ts", "charge"),
            "src/pay.ts#charge"
        );
        assert_eq!(
            ts_method_fqn("src/pay.ts", "Payment", "charge"),
            "src/pay.ts#Payment.charge"
        );
    }

    #[test]
    fn python_modules() {
        assert_eq!(python_module_path("payments/service.py"), "payments.service");
        assert_eq!(python_module_path("pkg/__init__.py"), "pkg");
        assert_eq!(
            py_method_fqn("payments.service", "PaymentService", "charge"),
            "payments.service.PaymentService.charge"
        );
    }
}
