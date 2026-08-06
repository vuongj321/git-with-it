use anyhow::Result;
use clap::{Parser, Subcommand};
use gwi_graph::GraphBuilder;
use gwi_link::LinkedFile;
use gwi_parse::ANALYZER_VERSION;
use std::io::{self, Read};

#[derive(Parser, Debug)]
#[command(name = "gwi-graph", about = "Build package/file graph JSON from linked parse JSONL")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Read linked JSONL from stdin; emit GraphSnapshot JSON
    Build {
        #[arg(long)]
        repo_id: String,
        #[arg(long)]
        sha: String,
        #[arg(long, default_value = ANALYZER_VERSION)]
        analyzer_version: String,
        #[arg(long, default_value_t = true)]
        symbols: bool,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Build {
            repo_id,
            sha,
            analyzer_version,
            symbols,
        } => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            let mut linked = Vec::new();
            for line in input.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                linked.push(serde_json::from_str::<LinkedFile>(line)?);
            }
            let snap = GraphBuilder {
                repo_id,
                sha,
                analyzer_version,
                include_symbols: symbols,
            }
            .build(&linked);
            println!("{}", serde_json::to_string_pretty(&snap)?);
        }
    }
    Ok(())
}
