//! FQN normalization rules (Phase 1 ADR + Phase 5 Go/Java).
//!
//! - Paths use forward slashes
//! - TypeScript/JavaScript: `path#Symbol` / `path#Class.method`
//! - Python: `module.path.Class.method`
//! - Go: `module/pkg.Symbol` / `module/pkg.Type.Method` (module path from go.mod when known)
//! - Java: `com.example.Class` / `com.example.Class.method`

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

/// Resolve Go package path for FQNs.
/// Prefers `module_path` from go.mod + directory; falls back to directory / package name.
pub fn go_package_path(file_path: &str, module_root: Option<&str>, package_name: &str) -> String {
    let norm = normalize_path(file_path);
    let dir = norm.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    if let Some(module) = module_root {
        if dir.is_empty() || dir == "." {
            return module.to_string();
        }
        // If module_root already looks like a full import path leaf, use it.
        if !module.contains('/') && dir.ends_with(module) {
            // uncommon; keep module as-is
        }
        if dir.is_empty() {
            return module.to_string();
        }
        // When guess_package returns the go.mod module path, join with relative dir.
        if module.contains('.') || module.contains('/') {
            if dir == module || dir.starts_with(&format!("{module}/")) {
                return dir.to_string();
            }
            return format!("{module}/{dir}");
        }
    }
    if !dir.is_empty() {
        return dir.to_string();
    }
    if !package_name.is_empty() {
        return package_name.to_string();
    }
    "main".to_string()
}

/// Go file entity FQN: package path (or path when unknown).
pub fn go_file_fqn(pkg_path: &str, path: &str) -> String {
    if pkg_path.is_empty() {
        normalize_path(path)
    } else {
        pkg_path.to_string()
    }
}

/// Go top-level symbol: `pkg.Name`
pub fn go_symbol_fqn(pkg_path: &str, name: &str) -> String {
    if pkg_path.is_empty() {
        name.to_string()
    } else {
        format!("{pkg_path}.{name}")
    }
}

/// Go method: `pkg.Type.Method`
pub fn go_method_fqn(pkg_path: &str, type_name: &str, method: &str) -> String {
    if pkg_path.is_empty() {
        format!("{type_name}.{method}")
    } else {
        format!("{pkg_path}.{type_name}.{method}")
    }
}

/// Java file entity: package (or path).
pub fn java_file_fqn(package: &str, path: &str) -> String {
    if package.is_empty() {
        normalize_path(path)
    } else {
        package.to_string()
    }
}

/// Java type: `com.example.Name`
pub fn java_symbol_fqn(package: &str, name: &str) -> String {
    if package.is_empty() {
        name.to_string()
    } else {
        format!("{package}.{name}")
    }
}

/// Java method: `com.example.Class.method`
pub fn java_method_fqn(package: &str, class: &str, method: &str) -> String {
    if package.is_empty() {
        format!("{class}.{method}")
    } else {
        format!("{package}.{class}.{method}")
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

    #[test]
    fn go_fqns() {
        assert_eq!(
            go_package_path("payments/service.go", Some("github.com/gwi/go-mini"), "payments"),
            "github.com/gwi/go-mini/payments"
        );
        assert_eq!(
            go_symbol_fqn("github.com/gwi/go-mini/payments", "Charge"),
            "github.com/gwi/go-mini/payments.Charge"
        );
        assert_eq!(
            go_method_fqn("github.com/gwi/go-mini/payments", "Service", "Charge"),
            "github.com/gwi/go-mini/payments.Service.Charge"
        );
    }

    #[test]
    fn java_fqns() {
        assert_eq!(
            java_symbol_fqn("com.gwi.payments", "PaymentService"),
            "com.gwi.payments.PaymentService"
        );
        assert_eq!(
            java_method_fqn("com.gwi.payments", "PaymentService", "charge"),
            "com.gwi.payments.PaymentService.charge"
        );
    }
}
