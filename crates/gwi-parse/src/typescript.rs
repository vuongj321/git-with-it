//! TypeScript / JavaScript extraction via tree-sitter-typescript.

use crate::fqn::{ts_file_fqn, ts_method_fqn, ts_symbol_fqn};
use crate::model::{
    FileFacts, FileParseResult, Language, RefKind, Symbol, SymbolKind, UnresolvedRef,
};
use crate::util::{child_by_field, count_loc, node_span, node_text, parse_source};
use tree_sitter::Node;

pub fn extract_typescript(
    path: &str,
    source: &str,
    language: Language,
    package: Option<String>,
) -> anyhow::Result<FileParseResult> {
    let lang = match language {
        Language::Javascript => tree_sitter_typescript::LANGUAGE_TSX.into(),
        Language::Typescript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        other => anyhow::bail!("extract_typescript called with {other:?}"),
    };
    let tree = parse_source(lang, source)?;
    let root = tree.root_node();

    let mut symbols = Vec::new();
    let mut refs = Vec::new();

    // File entity
    symbols.push(Symbol {
        kind: SymbolKind::File,
        name: path_file_name(path),
        fqn: ts_file_fqn(path),
        span: node_span(root),
        export: false,
    });

    extract_ts_node(root, source, path, None, false, &mut symbols, &mut refs);

    Ok(FileParseResult::new(
        FileFacts {
            path: crate::fqn::normalize_path(path),
            language,
            loc: count_loc(source),
            package,
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

fn extract_ts_node(
    node: Node<'_>,
    source: &str,
    path: &str,
    class_name: Option<&str>,
    inherited_export: bool,
    symbols: &mut Vec<Symbol>,
    refs: &mut Vec<UnresolvedRef>,
) {
    let kind = node.kind();
    let is_export = inherited_export || kind == "export_statement";

    match kind {
        "export_statement" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                extract_ts_node(child, source, path, class_name, true, symbols, refs);
            }
            return;
        }
        "function_declaration" | "generator_function_declaration" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                let fqn = if let Some(cls) = class_name {
                    ts_method_fqn(path, cls, &name)
                } else {
                    ts_symbol_fqn(path, &name)
                };
                symbols.push(Symbol {
                    kind: if class_name.is_some() {
                        SymbolKind::Method
                    } else {
                        SymbolKind::Function
                    },
                    name,
                    fqn,
                    span: node_span(node),
                    export: is_export,
                });
            }
        }
        "class_declaration" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                symbols.push(Symbol {
                    kind: SymbolKind::Class,
                    name: name.clone(),
                    fqn: ts_symbol_fqn(path, &name),
                    span: node_span(node),
                    export: is_export,
                });
                if let Some(heritage) = child_by_field(node, "heritage") {
                    extract_heritage(heritage, source, refs);
                }
                // Also walk heritage via class_heritage child kinds
                let mut cursor = node.walk();
                for child in node.named_children(&mut cursor) {
                    if child.kind() == "class_heritage" {
                        extract_heritage(child, source, refs);
                    } else if child.kind() == "class_body" {
                        extract_class_body(child, source, path, &name, is_export, symbols, refs);
                    } else if child.kind() != "type_identifier" && child.kind() != "identifier" {
                        extract_ts_node(
                            child,
                            source,
                            path,
                            Some(&name),
                            is_export,
                            symbols,
                            refs,
                        );
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
                    name,
                    fqn: ts_symbol_fqn(path, node_text(name_node, source)),
                    span: node_span(node),
                    export: is_export,
                });
            }
        }
        "lexical_declaration" | "variable_declaration" => {
            extract_variable_declarators(node, source, path, is_export, symbols);
        }
        "method_definition" => {
            if let Some(cls) = class_name {
                if let Some(name_node) = child_by_field(node, "name") {
                    let name = node_text(name_node, source).to_string();
                    // skip constructors as methods named "constructor" — still record
                    symbols.push(Symbol {
                        kind: SymbolKind::Method,
                        name: name.clone(),
                        fqn: ts_method_fqn(path, cls, &name),
                        span: node_span(node),
                        export: is_export,
                    });
                }
            }
        }
        "import_statement" => {
            if let Some(source_node) = child_by_field(node, "source") {
                let raw = strip_quotes(node_text(source_node, source));
                refs.push(UnresolvedRef {
                    kind: RefKind::Import,
                    raw,
                    span: node_span(node),
                });
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
        // Avoid double-walking class internals already handled
        if kind == "class_declaration" {
            continue;
        }
        extract_ts_node(
            child,
            source,
            path,
            class_name,
            is_export && kind == "export_statement",
            symbols,
            refs,
        );
    }
}

fn extract_class_body(
    body: Node<'_>,
    source: &str,
    path: &str,
    class_name: &str,
    is_export: bool,
    symbols: &mut Vec<Symbol>,
    refs: &mut Vec<UnresolvedRef>,
) {
    let mut cursor = body.walk();
    for child in body.named_children(&mut cursor) {
        extract_ts_node(
            child,
            source,
            path,
            Some(class_name),
            is_export,
            symbols,
            refs,
        );
    }
}

fn extract_heritage(node: Node<'_>, source: &str, refs: &mut Vec<UnresolvedRef>) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        match child.kind() {
            "extends_clause" | "implements_clause" => {
                let kind = if child.kind() == "extends_clause" {
                    RefKind::Extends
                } else {
                    RefKind::Implements
                };
                let mut inner = child.walk();
                for id in child.named_children(&mut inner) {
                    if id.kind() == "type_identifier" || id.kind() == "identifier" {
                        refs.push(UnresolvedRef {
                            kind,
                            raw: node_text(id, source).to_string(),
                            span: node_span(id),
                        });
                    } else if id.kind() == "member_expression" || id.kind() == "qualified_name" {
                        refs.push(UnresolvedRef {
                            kind,
                            raw: node_text(id, source).to_string(),
                            span: node_span(id),
                        });
                    }
                }
            }
            "type_identifier" | "identifier" => {
                refs.push(UnresolvedRef {
                    kind: RefKind::Extends,
                    raw: node_text(child, source).to_string(),
                    span: node_span(child),
                });
            }
            _ => extract_heritage(child, source, refs),
        }
    }
}

fn extract_variable_declarators(
    node: Node<'_>,
    source: &str,
    path: &str,
    is_export: bool,
    symbols: &mut Vec<Symbol>,
) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() != "variable_declarator" {
            continue;
        }
        let Some(name_node) = child_by_field(child, "name") else {
            continue;
        };
        // Only top-level const/let functions via arrow: treat identifier as variable;
        // if value is arrow_function / function, treat as function.
        let name = node_text(name_node, source).to_string();
        let value = child_by_field(child, "value");
        let kind = match value.map(|v| v.kind()) {
            Some("arrow_function" | "function" | "function_expression") => SymbolKind::Function,
            _ => SymbolKind::Variable,
        };
        // Skip non-exported variables to reduce noise (keep exported + functions)
        if kind == SymbolKind::Variable && !is_export {
            continue;
        }
        symbols.push(Symbol {
            kind,
            name: name.clone(),
            fqn: ts_symbol_fqn(path, &name),
            span: node_span(child),
            export: is_export,
        });
    }
}

fn strip_quotes(s: &str) -> String {
    s.trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .to_string()
}
