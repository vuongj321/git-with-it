//! Go extraction via tree-sitter-go.

use crate::fqn::{go_file_fqn, go_method_fqn, go_symbol_fqn, go_package_path};
use crate::model::{
    FileFacts, FileParseResult, Language, RefKind, Symbol, SymbolKind, UnresolvedRef,
};
use crate::util::{child_by_field, count_loc, node_span, node_text, parse_source};
use tree_sitter::Node;

pub fn extract_go(
    path: &str,
    source: &str,
    package: Option<String>,
) -> anyhow::Result<FileParseResult> {
    let tree = parse_source(tree_sitter_go::LANGUAGE.into(), source)?;
    let root = tree.root_node();

    let mut package_name = String::new();
    let mut symbols = Vec::new();
    let mut refs = Vec::new();

    // First pass: package clause
    let mut cursor = root.walk();
    for child in root.named_children(&mut cursor) {
        if child.kind() == "package_clause" {
            if let Some(name_node) = child_by_field(child, "name")
                .or_else(|| child.named_child(0))
            {
                package_name = node_text(name_node, source).to_string();
            }
        }
    }

    let pkg_path = go_package_path(path, package.as_deref(), &package_name);

    symbols.push(Symbol {
        kind: SymbolKind::File,
        name: path_file_name(path),
        fqn: go_file_fqn(&pkg_path, path),
        span: node_span(root),
        export: true,
    });

    extract_go_node(root, source, &pkg_path, &mut symbols, &mut refs);

    Ok(FileParseResult::new(
        FileFacts {
            path: crate::fqn::normalize_path(path),
            language: Language::Go,
            loc: count_loc(source),
            package: Some(pkg_path),
        },
        symbols,
        refs,
    ))
}

fn path_file_name(path: &str) -> String {
    crate::fqn::normalize_path(path)
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string()
}

fn extract_go_node(
    node: Node<'_>,
    source: &str,
    pkg_path: &str,
    symbols: &mut Vec<Symbol>,
    refs: &mut Vec<UnresolvedRef>,
) {
    match node.kind() {
        "import_declaration" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                collect_go_imports(child, source, refs);
            }
            return;
        }
        "function_declaration" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                let export = name
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_uppercase())
                    .unwrap_or(false);
                symbols.push(Symbol {
                    kind: SymbolKind::Function,
                    name: name.clone(),
                    fqn: go_symbol_fqn(pkg_path, &name),
                    span: node_span(node),
                    export,
                });
            }
        }
        "method_declaration" => {
            let receiver_type = child_by_field(node, "receiver")
                .and_then(|recv| find_go_type_ident(recv, source))
                .unwrap_or_default();
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                let export = name
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_uppercase())
                    .unwrap_or(false);
                let fqn = if receiver_type.is_empty() {
                    go_symbol_fqn(pkg_path, &name)
                } else {
                    go_method_fqn(pkg_path, &receiver_type, &name)
                };
                symbols.push(Symbol {
                    kind: SymbolKind::Method,
                    name,
                    fqn,
                    span: node_span(node),
                    export,
                });
            }
        }
        "type_declaration" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if child.kind() == "type_spec" {
                    if let Some(name_node) = child_by_field(child, "name") {
                        let name = node_text(name_node, source).to_string();
                        let export = name
                            .chars()
                            .next()
                            .map(|c| c.is_ascii_uppercase())
                            .unwrap_or(false);
                        let type_node = child_by_field(child, "type");
                        let kind = match type_node.map(|n| n.kind()) {
                            Some("interface_type") => SymbolKind::Interface,
                            _ => SymbolKind::Class,
                        };
                        symbols.push(Symbol {
                            kind,
                            name: name.clone(),
                            fqn: go_symbol_fqn(pkg_path, &name),
                            span: node_span(child),
                            export,
                        });
                        if let Some(t) = type_node {
                            if t.kind() == "struct_type" || t.kind() == "interface_type" {
                                // embedded types / interface methods walked below
                            }
                        }
                    }
                }
            }
        }
        "call_expression" => {
            if let Some(fn_node) = child_by_field(node, "function") {
                let raw = node_text(fn_node, source).to_string();
                if !raw.is_empty() {
                    refs.push(UnresolvedRef {
                        kind: RefKind::Call,
                        raw,
                        span: node_span(fn_node),
                    });
                }
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        extract_go_node(child, source, pkg_path, symbols, refs);
    }
}

fn collect_go_imports(node: Node<'_>, source: &str, refs: &mut Vec<UnresolvedRef>) {
    match node.kind() {
        "import_spec" => {
            let mut path_node = child_by_field(node, "path");
            if path_node.is_none() {
                let mut c = node.walk();
                for n in node.named_children(&mut c) {
                    if n.kind() == "interpreted_string_literal" {
                        path_node = Some(n);
                        break;
                    }
                }
            }
            if let Some(p) = path_node {
                let raw = node_text(p, source)
                    .trim_matches('"')
                    .trim_matches('`')
                    .to_string();
                if !raw.is_empty() {
                    refs.push(UnresolvedRef {
                        kind: RefKind::Import,
                        raw,
                        span: node_span(p),
                    });
                }
            }
        }
        "import_spec_list" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                collect_go_imports(child, source, refs);
            }
        }
        _ => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                collect_go_imports(child, source, refs);
            }
        }
    }
}

fn find_go_type_ident(node: Node<'_>, source: &str) -> Option<String> {
    match node.kind() {
        "type_identifier" => Some(node_text(node, source).to_string()),
        "pointer_type" => child_by_field(node, "type")
            .or_else(|| node.named_child(0))
            .and_then(|n| find_go_type_ident(n, source)),
        "qualified_type" => child_by_field(node, "name")
            .or_else(|| node.named_child(node.named_child_count().saturating_sub(1)))
            .and_then(|n| {
                if n.kind() == "type_identifier" {
                    Some(node_text(n, source).to_string())
                } else {
                    find_go_type_ident(n, source)
                }
            }),
        "parameter_declaration" | "parameter_list" | "parameter_declaration_list" => {
            if let Some(t) = child_by_field(node, "type") {
                return find_go_type_ident(t, source);
            }
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if let Some(name) = find_go_type_ident(child, source) {
                    return Some(name);
                }
            }
            None
        }
        "identifier" => None,
        _ => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if let Some(name) = find_go_type_ident(child, source) {
                    return Some(name);
                }
            }
            None
        }
    }
}
