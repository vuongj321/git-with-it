use anyhow::Result;
use clap::{Parser, Subcommand};
use gwi_metrics::{compute_metrics, MetricsRequest};
use std::io::{self, Read};

#[derive(Parser, Debug)]
#[command(name = "gwi-metrics", about = "Compute architectural metrics from GraphSnapshot JSON")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Read MetricsRequest JSON from stdin; emit MetricRow[] JSON
    Compute,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Compute => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            let req: MetricsRequest = serde_json::from_str(&input)?;
            let rows = compute_metrics(&req);
            println!("{}", serde_json::to_string_pretty(&rows)?);
        }
    }
    Ok(())
}
