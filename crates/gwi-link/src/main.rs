use anyhow::Result;
use clap::{Parser, Subcommand};
use gwi_link::link_parse_jsonl;
use std::io::{self, Read};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "gwi-link", about = "Resolve imports to file FQNs")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Read gwi-parse JSONL from stdin; write linked JSONL to stdout
    Jsonl {
        #[arg(long)]
        root: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Jsonl { root } => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            for file in link_parse_jsonl(&input, root.as_deref())? {
                println!("{}", serde_json::to_string(&file)?);
            }
        }
    }
    Ok(())
}
