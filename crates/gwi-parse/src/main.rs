use anyhow::Result;
use clap::{Parser, Subcommand};
use gwi_parse::{collect_package_symbols, parse_dir, parse_file, Symbol};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "gwi-parse", about = "Git With It tree-sitter symbol extractor")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Parse a single source file → JSON on stdout
    File {
        #[arg(long)]
        path: PathBuf,
        /// Optional repo root for relative paths / package guess
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Parse all supported sources under a directory → JSONL (one file result per line)
    Dir {
        #[arg(long)]
        root: PathBuf,
        /// Also emit package symbols as a synthetic first record
        #[arg(long, default_value_t = true)]
        packages: bool,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::File { path, root } => {
            let result = parse_file(root.as_deref(), &path)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Commands::Dir { root, packages } => {
            if packages {
                let pkgs = collect_package_symbols(&root);
                if !pkgs.is_empty() {
                    let synthetic = PackageRecord {
                        analyzer_version: gwi_parse::ANALYZER_VERSION.to_string(),
                        symbols: pkgs,
                    };
                    println!("{}", serde_json::to_string(&synthetic)?);
                }
            }
            for file in parse_dir(&root)? {
                println!("{}", serde_json::to_string(&file)?);
            }
        }
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct PackageRecord {
    analyzer_version: String,
    symbols: Vec<Symbol>,
}
