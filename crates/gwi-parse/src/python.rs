//! Python extraction via tree-sitter-python.

use crate::fqn::{py_method_fqn, py_symbol_fqn, python_module_path};
use crate::model::{
    FileFacts, FileParseResult, Language, RefKind, Symbol, SymbolKind, UnresolvedRef,
};
use crate::util::{child_by_field, count_loc, node_span, node_text, parse_source};
use tree_sitter::Node;

pub fn extract_python(
    path: &str,
    source: &str,
    package: Option<String>,
) -> anyhow::Result<FileParseResult> {
    let tree = parse_source(tree_sitter_python::LANGUAGE.into(), source)?;
    let root = tree.root_node();
    let module = python_module_path(path);

    let mut symbols = Vec::new();
    let mut refs = Vec::new();

    symbols.push(Symbol {
        kind: SymbolKind::File,
        name: path_file_name(path),
        fqn: module.clone(),
        span: node_span(root),
        export: true,
    });

    extract_py_node(root, source, &module, None, &mut symbols, &mut refs);

    Ok(FileParseResult::new(
        FileFacts {
            path: crate::fqn::normalize_path(path),
            language: Language::Python,
            loc: count_loc(source),
            package: package.or_else(|| Some(module)),
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

fn extract_py_node(
    node: Node<'_>,
    source: &str,
    module: &str,
    class_name: Option<&str>,
    symbols: &mut Vec<Symbol>,
    refs: &mut Vec<UnresolvedRef>,
) {
    match node.kind() {
        "class_definition" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                symbols.push(Symbol {
                    kind: SymbolKind::Class,
                    name: name.clone(),
                    fqn: py_symbol_fqn(module, &name),
                    span: node_span(node),
                    export: true,
                });
                // bases
                if let Some(superclasses) = child_by_field(node, "superclasses") {
                    let mut cursor = superclasses.walk();
                    for base in superclasses.named_children(&mut cursor) {
                        let raw = node_text(base, source).to_string();
                        if !raw.is_empty() {
                            refs.push(UnresolvedRef {
                                kind: RefKind::Extends,
                                raw,
                                span: node_span(base),
                            });
                        }
                    }
                }
                if let Some(body) = child_by_field(node, "body") {
                    let mut cursor = body.walk();
                    for child in body.named_children(&mut cursor) {
                        extract_py_node(child, source, module, Some(&name), symbols, refs);
                    }
                }
                return;
            }
        }
        "function_definition" => {
            if let Some(name_node) = child_by_field(node, "name") {
                let name = node_text(name_node, source).to_string();
                let (kind, fqn) = if let Some(cls) = class_name {
                    (SymbolKind::Method, py_method_fqn(module, cls, &name))
                } else {
                    (SymbolKind::Function, py_symbol_fqn(module, &name))
                };
                symbols.push(Symbol {
                    kind,
                    name,
                    fqn,
                    span: node_span(node),
                    export: true,
                });
            }
            // still walk body for nested defs / calls
            if let Some(body) = child_by_field(node, "body") {
                let mut cursor = body.walk();
                for child in body.named_children(&mut cursor) {
                    extract_py_node(child, source, module, class_name, symbols, refs);
                }
            }
            return;
        }
        "import_statement" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if child.kind() == "dotted_name" || child.kind() == "aliased_import" {
                    let raw = if child.kind() == "aliased_import" {
                        child_by_field(child, "name")
                            .map(|n| node_text(n, source).to_string())
                            .unwrap_or_else(|| node_text(child, source).to_string())
                    } else {
                        node_text(child, source).to_string()
                    };
                    refs.push(UnresolvedRef {
                        kind: RefKind::Import,
                        raw,
                        span: node_span(child),
                    });
                }
            }
        }
        "import_from_statement" => {
            let module_name = child_by_field(node, "module_name")
                .map(|n| node_text(n, source).to_string())
                .unwrap_or_default();
            let mut names = Vec::new();
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if child.kind() == "dotted_name"
                    && Some(child.id())
                        != child_by_field(node, "module_name").map(|n| n.id())
                {
                    names.push(node_text(child, source).to_string());
                } else if child.kind() == "aliased_import" {
                    if let Some(n) = child_by_field(child, "name") {
                        names.push(node_text(n, source).to_string());
                    }
                } else if child.kind() == "wildcard_import" {
                    names.push("*".to_string());
                }
            }
            let raw = if names.is_empty() {
                module_name
            } else if module_name.is_empty() {
                names.join(", ")
            } else {
                format!("{module_name}:{}", names.join(","))
            };
            refs.push(UnresolvedRef {
                kind: RefKind::Import,
                raw,
                span: node_span(node),
            });
        }
        "call" => {
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
        extract_py_node(child, source, module, class_name, symbols, refs);
    }
}
