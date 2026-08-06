//! tree-sitter helpers shared by language extractors.

use crate::model::Span;
use tree_sitter::{Node, Tree};

pub fn parse_source(language: tree_sitter::Language, source: &str) -> anyhow::Result<Tree> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&language)
        .map_err(|e| anyhow::anyhow!("set_language: {e}"))?;
    parser
        .parse(source, None)
        .ok_or_else(|| anyhow::anyhow!("tree-sitter returned no tree"))
}

pub fn node_span(node: Node<'_>) -> Span {
    let start = node.start_position();
    let end = node.end_position();
    Span {
        start_line: start.row as u32 + 1,
        start_col: start.column as u32,
        end_line: end.row as u32 + 1,
        end_col: end.column as u32,
    }
}

pub fn node_text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    node.utf8_text(source.as_bytes()).unwrap_or("")
}

pub fn child_by_field<'a>(node: Node<'a>, field: &str) -> Option<Node<'a>> {
    node.child_by_field_name(field)
}

pub fn count_loc(source: &str) -> u32 {
    if source.is_empty() {
        return 0;
    }
    let lines = source.lines().count() as u32;
    // Preserve trailing newline as an extra blank line count? Prefer physical lines.
    if source.ends_with('\n') {
        lines
    } else {
        lines.max(1)
    }
}
