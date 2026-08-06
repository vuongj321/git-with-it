//! Golden fixture tests for ts-mini / py-mini repos.

use gwi_parse::{parse_dir, SymbolKind};
use pretty_assertions::assert_eq;
use serde_json::Value;
use std::path::PathBuf;

fn testdata(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata")
        .join(rel)
}

fn symbol_summary(results: &[gwi_parse::FileParseResult]) -> Vec<(String, String, String)> {
    let mut rows = Vec::new();
    for r in results {
        for s in &r.symbols {
            rows.push((
                format!("{:?}", s.kind).to_ascii_lowercase(),
                s.name.clone(),
                s.fqn.clone(),
            ));
        }
    }
    rows.sort();
    rows
}

fn ref_summary(results: &[gwi_parse::FileParseResult]) -> Vec<(String, String, String)> {
    let mut rows = Vec::new();
    for r in results {
        for rf in &r.refs {
            rows.push((
                r.file.path.clone(),
                format!("{:?}", rf.kind).to_ascii_lowercase(),
                rf.raw.clone(),
            ));
        }
    }
    rows.sort();
    rows
}

#[test]
fn ts_mini_extracts_packages_files_classes_functions_imports() {
    let root = testdata("repos/ts-mini");
    let results = parse_dir(&root).expect("parse ts-mini");
    assert_eq!(results.len(), 2);

    let packages: Vec<_> = results
        .iter()
        .filter_map(|r| r.file.package.as_deref())
        .collect();
    assert!(packages.iter().all(|p| *p == "@gwi/ts-mini"));

    let fqns: Vec<_> = results
        .iter()
        .flat_map(|r| r.symbols.iter().map(|s| s.fqn.as_str()))
        .collect();
    assert!(fqns.contains(&"src/payments.ts#PaymentService"));
    assert!(fqns.contains(&"src/payments.ts#PaymentService.charge"));
    assert!(fqns.contains(&"src/payments.ts#applyFee"));
    assert!(fqns.contains(&"src/checkout.ts#runCheckout"));
    assert!(fqns.contains(&"src/payments.ts#Payable"));

    let imports: Vec<_> = results
        .iter()
        .flat_map(|r| r.refs.iter())
        .filter(|r| matches!(r.kind, gwi_parse::RefKind::Import))
        .map(|r| r.raw.as_str())
        .collect();
    assert!(imports.contains(&"./payments"));

    let implements: Vec<_> = results
        .iter()
        .flat_map(|r| r.refs.iter())
        .filter(|r| matches!(r.kind, gwi_parse::RefKind::Implements))
        .map(|r| r.raw.as_str())
        .collect();
    assert!(implements.contains(&"Payable"));
}

#[test]
fn py_mini_extracts_modules_classes_methods_imports() {
    let root = testdata("repos/py-mini");
    let results = parse_dir(&root).expect("parse py-mini");
    assert!(results.len() >= 2);

    let fqns: Vec<_> = results
        .iter()
        .flat_map(|r| r.symbols.iter().map(|s| s.fqn.as_str()))
        .collect();
    assert!(fqns.contains(&"payments.service.PaymentService"));
    assert!(fqns.contains(&"payments.service.PaymentService.charge"));
    assert!(fqns.contains(&"payments.checkout.Checkout"));
    assert!(fqns.contains(&"payments.checkout.apply_fee"));

    let imports: Vec<_> = results
        .iter()
        .flat_map(|r| r.refs.iter())
        .filter(|r| matches!(r.kind, gwi_parse::RefKind::Import))
        .map(|r| r.raw.as_str())
        .collect();
    assert!(imports.iter().any(|i| i.contains("payments.service")));
}

#[test]
fn golden_summaries_match() {
    for name in ["ts-mini", "py-mini"] {
        let root = testdata(&format!("repos/{name}"));
        let results = parse_dir(&root).unwrap();
        let actual = serde_json::json!({
            "symbols": symbol_summary(&results),
            "refs": ref_summary(&results),
        });
        let golden_path = testdata(&format!("goldens/{name}.parse.json"));
        if std::env::var("GWI_UPDATE_GOLDENS").as_deref() == Ok("1") {
            if let Some(parent) = golden_path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(
                &golden_path,
                serde_json::to_string_pretty(&actual).unwrap() + "\n",
            )
            .unwrap();
        }
        let expected: Value = serde_json::from_str(
            &std::fs::read_to_string(&golden_path)
                .unwrap_or_else(|_| panic!("missing golden {golden_path:?}; run with GWI_UPDATE_GOLDENS=1")),
        )
        .unwrap();
        assert_eq!(actual, expected, "golden mismatch for {name}");
    }
}

#[test]
fn file_kind_present_for_each_source() {
    let results = parse_dir(&testdata("repos/ts-mini")).unwrap();
    for r in results {
        assert!(
            r.symbols
                .iter()
                .any(|s| matches!(s.kind, SymbolKind::File)),
            "missing file symbol for {}",
            r.file.path
        );
    }
}
