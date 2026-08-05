use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process::Command;
use url::Url;

#[derive(Parser, Debug)]
#[command(name = "gwi-git", about = "Git With It bare clone / fetch helper")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Clone a remote as a bare repository into --path
    Clone {
        /// Remote URL (https)
        #[arg(long)]
        url: String,
        /// Destination directory for the bare repo
        #[arg(long)]
        path: PathBuf,
        /// Optional branch to set as HEAD after clone
        #[arg(long)]
        branch: Option<String>,
        /// Optional token for private HTTPS remotes (x-access-token)
        #[arg(long)]
        token: Option<String>,
    },
    /// Fetch updates into an existing bare repository
    Fetch {
        #[arg(long)]
        path: PathBuf,
        #[arg(long)]
        token: Option<String>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Clone {
            url,
            path,
            branch,
            token,
        } => cmd_clone(url, path, branch, token),
        Commands::Fetch { path, token } => cmd_fetch(path, token),
    }
}

fn inject_token(url: &str, token: Option<&str>) -> Result<String> {
    let Some(token) = token else {
        return Ok(url.to_string());
    };
    let mut parsed = Url::parse(url).context("invalid remote url")?;
    let _ = parsed.set_username("x-access-token");
    let _ = parsed.set_password(Some(token));
    Ok(parsed.to_string())
}

fn cmd_clone(
    url: String,
    path: PathBuf,
    branch: Option<String>,
    token: Option<String>,
) -> Result<()> {
    if path.exists() {
        bail!("destination already exists: {}", path.display());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("create parent dirs")?;
    }

    let auth_url = inject_token(&url, token.as_deref())?;
    let mut args = vec![
        "clone".to_string(),
        "--bare".to_string(),
        auth_url,
        path.display().to_string(),
    ];
    if let Some(b) = &branch {
        args.insert(1, format!("--branch={b}"));
    }

    run_git(&args)?;

    if let Some(b) = branch {
        run_git(&[
            "-C".to_string(),
            path.display().to_string(),
            "symbolic-ref".to_string(),
            "HEAD".to_string(),
            format!("refs/heads/{b}"),
        ])?;
    }

    Ok(())
}

fn cmd_fetch(path: PathBuf, token: Option<String>) -> Result<()> {
    if !path.exists() {
        bail!("bare repo path does not exist: {}", path.display());
    }

    if let Some(token) = token.as_deref() {
        let origin = git_output(&path, &["remote", "get-url", "origin"])?;
        let auth_url = inject_token(origin.trim(), Some(token))?;
        run_git(&[
            "-C".to_string(),
            path.display().to_string(),
            "remote".to_string(),
            "set-url".to_string(),
            "origin".to_string(),
            auth_url,
        ])?;
    }

    run_git(&[
        "-C".to_string(),
        path.display().to_string(),
        "fetch".to_string(),
        "--all".to_string(),
        "--prune".to_string(),
    ])?;

    Ok(())
}

fn run_git(args: &[String]) -> Result<()> {
    let status = Command::new("git")
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .status()
        .context("failed to spawn git")?;
    if !status.success() {
        bail!("git {:?} failed with {status}", args);
    }
    Ok(())
}

fn git_output(cwd: &PathBuf, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .context("failed to spawn git")?;
    if !output.status.success() {
        bail!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(String::from_utf8(output.stdout)?)
}
