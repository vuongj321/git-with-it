//! Shared parse model: symbols + unresolved refs emitted as JSONL / JSON.

use serde::{Deserialize, Serialize};

/// Analyzer version stamped into parse artifacts (bump when extraction changes).
pub const ANALYZER_VERSION: &str = "0.2.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    Typescript,
    Javascript,
    Python,
    Go,
    Java,
}

impl Language {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Typescript => "typescript",
            Self::Javascript => "javascript",
            Self::Python => "python",
            Self::Go => "go",
            Self::Java => "java",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Package,
    File,
    Class,
    Interface,
    Function,
    Method,
    Variable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    Import,
    Call,
    Extends,
    Implements,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    /// 1-based line
    pub start_line: u32,
    /// 0-based byte column within the line
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Symbol {
    pub kind: SymbolKind,
    pub name: String,
    pub fqn: String,
    pub span: Span,
    pub export: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnresolvedRef {
    pub kind: RefKind,
    pub raw: String,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileFacts {
    pub path: String,
    pub language: Language,
    pub loc: u32,
    /// Nearest package root guess (`package.json` name, Python package path, or dir).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileParseResult {
    pub analyzer_version: String,
    pub file: FileFacts,
    pub symbols: Vec<Symbol>,
    pub refs: Vec<UnresolvedRef>,
}

impl FileParseResult {
    pub fn new(file: FileFacts, symbols: Vec<Symbol>, refs: Vec<UnresolvedRef>) -> Self {
        Self {
            analyzer_version: ANALYZER_VERSION.to_string(),
            file,
            symbols,
            refs,
        }
    }
}
