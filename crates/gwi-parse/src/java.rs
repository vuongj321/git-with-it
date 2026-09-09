//! Java extraction via tree-sitter-java.

use crate::fqn::{java_file_fqn, java_method_fqn, java_symbol_fqn};
use crate::model::{
    FileFacts, FileParseResult, Language, RefKind, Symbol, SymbolKind, UnresolvedRef,
};
use crate::util::{child_by_field, count_loc, node_span, node_text, parse_source};
use tree_sitter::Node;

pub fn extract_java(
    path: &str,
    source: &str,
    package: Option<String>,
) -> anyhow::Result<FileParseResult> {
    let tree = parse_source(tree_sitter_java::LANGUAGE.into(), source)?;
    let root = tree.root_node();

    let mut package_name = String::new();
    let mut symbols = Vec::new();
    let mut refs = Vec::new();

    let mut cursor = root.walk();
    for child in root.named_children(&mut cursor) {
        if child.kind() == "package_declaration" {
            let mut name_node = child_by_field(child, "name");
            if name_node.is_none() {
                let mut c = child.walk();
                for n in child.named_children(&mut c) {
                    if n.kind() == "scoped_identifier" || n.kind() == "identifier" {
                        name_node = Some(n);
                        break;
                    }
                }
            }
            if let Some(name_node) = name_node {
                package_name = node_text(name_node, source).to_string();
            }
        }
    }

    let pkg = package.unwrap_or_else(|| {
        if package_name.is_empty() {
            java_package_from_path(path)
        } else {
            package_name.clone()
        }
    });

    symbols.push(Symbol {
        kind: SymbolKind::File,
        name: path_file_name(path),
        fqn: java_file_fqn(&pkg, path),
        span: node_span(root),
        export: true,
    });

    extract_java_node(root, source, &pkg, None, &mut symbols, &mut refs);

    Ok(FileParseResult::new(
        FileFacts {
            path: crate::fqn::normalize_path(path),
            language: Language::Java,
            loc: count_loc(source),
            package: Some(pkg),
        },
        symbols,
        refs,
    ))
}

fn java_package_from_path(path: &str) -> String {
    let norm = crate::fqn::normalize_path(path);
    let dir = norm.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    // Prefer path under src/main/java or src/test/java
    for marker in ["src/main/java/", "src/test/java/", "src/"] {
        if let Some(idx) = dir.find(marker) {
            let rest = &dir[idx + marker.len()..];
            return rest.replace('/', ".");
        }
    }
    dir.replace('/', ".")
}

fn path_file_name(path: &str) -> String {
    crate::fqn::normalize_path(path)
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string()
}

fn extract_java_node(
    node: Node<'_>,
    source: &str,
    pkg: &str,
    class_name: Option<&str>,
    symbols: &mut Vec<Symbol>,
    refs: &mut Vec<UnresolvedRef>,
) {
    match node.kind() {
        "import_declaration" => {
            let mut c = node.walk();
            let named = node
                .named_children(&mut c)
                .find(|n| {
                    matches!(
                        n.kind(),
                        "scoped_identifier" | "identifier" | "asterisk"
                    )
                })
                .map(|n| node_text(n, source).to_string());
            let raw = named.unwrap_or_else(|| {
                node_text(node, source)
                    .trim()
                    .trim_start_matches("import")
                    .trim()
                    .trim_end_matches(';')
                    .trim()
                    .to_string()
            });
            if !raw.is_empty() {
                refs.push(UnresolvedRef {
                    kind: RefKind::Import,
                    raw,
                    span: node_span(node),
                });
            }
            return;
        }
        "class_declaration" | "enum_declaration" | "record_declaration" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                symbols.push(Symbol {
                    kind: SymbolKind::Class,
                    name: name.clone(),
                    fqn: java_symbol_fqn(pkg, &name),
                    span: node_span(node),
                    export: true,
                });
                if let Some(sc) = child_by_field(node, "superclass") {
                    let raw = node_text(sc, source)
                        .trim()
                        .trim_start_matches("extends")
                        .trim()
                        .to_string();
                    if !raw.is_empty() {
                        refs.push(UnresolvedRef {
                            kind: RefKind::Extends,
                            raw,
                            span: node_span(sc),
                        });
                    }
                }
                if let Some(ifaces) = child_by_field(node, "interfaces") {
                    let mut c = ifaces.walk();
                    for child in ifaces.named_children(&mut c) {
                        let raw = node_text(child, source).to_string();
                        if !raw.is_empty() && raw != "implements" {
                            refs.push(UnresolvedRef {
                                kind: RefKind::Implements,
                                raw,
                                span: node_span(child),
                            });
                        }
                    }
                }
                if let Some(body) = child_by_field(node, "body") {
                    let mut c = body.walk();
                    for child in body.named_children(&mut c) {
                        extract_java_node(child, source, pkg, Some(&name), symbols, refs);
                    }
                }
                return;
            }
        }
        "interface_declaration" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                symbols.push(Symbol {
                    kind: SymbolKind::Interface,
                    name: name.clone(),
                    fqn: java_symbol_fqn(pkg, &name),
                    span: node_span(node),
                    export: true,
                });
                if let Some(body) = child_by_field(node, "body") {
                    let mut c = body.walk();
                    for child in body.named_children(&mut c) {
                        extract_java_node(child, source, pkg, Some(&name), symbols, refs);
                    }
                }
                return;
            }
        }
        "method_declaration" | "constructor_declaration" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                let (kind, fqn) = if let Some(cls) = class_name {
                    (SymbolKind::Method, java_method_fqn(pkg, cls, &name))
                } else {
                    (SymbolKind::Function, java_symbol_fqn(pkg, &name))
                };
                symbols.push(Symbol {
                    kind,
                    name,
                    fqn,
                    span: node_span(node),
                    export: true,
                });
            }
        }
        "method_invocation" => {
            let name = child_by_field(node, "name")
                .map(|n| node_text(n, source).to_string())
                .unwrap_or_default();
            let object = child_by_field(node, "object")
                .map(|n| node_text(n, source).to_string())
                .unwrap_or_default();
            let raw = if object.is_empty() {
                name
            } else {
                format!("{object}.{name}")
            };
            if !raw.is_empty() {
                refs.push(UnresolvedRef {
                    kind: RefKind::Call,
                    raw,
                    span: node_span(node),
                });
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        extract_java_node(child, source, pkg, class_name, symbols, refs);
    }
}
