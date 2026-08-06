use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use url::Url;

#[derive(Parser, Debug)]
#[command(name = "gwi-git", about = "Git With It bare clone / fetch / blob helper")]
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
    /// Resolve HEAD (or a ref) to a commit SHA
    RevParse {
        #[arg(long)]
        path: PathBuf,
        #[arg(long, default_value = "HEAD")]
        rev: String,
    },
    /// List blob paths at a commit (name-only, recursive)
    LsTree {
        #[arg(long)]
        path: PathBuf,
        #[arg(long)]
        sha: String,
        /// Optional path prefix filter (e.g. src/)
        #[arg(long)]
        prefix: Option<String>,
    },
    /// Print blob contents for an OID (or `sha:path`) to stdout
    CatFile {
        #[arg(long)]
        path: PathBuf,
        /// Object id or `commit:path` tree-ish
        #[arg(long)]
        oid: String,
    },
    /// Resolve a path at a commit to a blob OID
    BlobOid {
        #[arg(long)]
        path: PathBuf,
        #[arg(long)]
        sha: String,
        #[arg(long)]
        file: String,
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
        Commands::RevParse { path, rev } => {
            let sha = git_output(&path, &["rev-parse", &rev])?;
            print!("{}", sha.trim());
            Ok(())
        }
        Commands::LsTree { path, sha, prefix } => cmd_ls_tree(path, sha, prefix),
        Commands::CatFile { path, oid } => cmd_cat_file(path, oid),
        Commands::BlobOid { path, sha, file } => {
            let oid = git_output(&path, &["rev-parse", &format!("{sha}:{file}")])?;
            print!("{}", oid.trim());
            Ok(())
        }
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

fn cmd_ls_tree(path: PathBuf, sha: String, prefix: Option<String>) -> Result<()> {
    let mut args = vec!["ls-tree", "-r", "--name-only", &sha];
    let prefix_owned;
    if let Some(p) = prefix {
        prefix_owned = p;
        args.push(&prefix_owned);
    }
    let out = git_output(&path, &args)?;
    print!("{out}");
    Ok(())
}

fn cmd_cat_file(path: PathBuf, oid: String) -> Result<()> {
    // Stream blob bytes to stdout (may be binary)
    let status = Command::new("git")
        .args(["-C", &path.display().to_string(), "cat-file", "-p", &oid])
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("spawn git cat-file")?
        .wait_with_output()
        .context("wait git cat-file")?;
    if !status.status.success() {
        bail!(
            "git cat-file failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }
    io::stdout()
        .write_all(&status.stdout)
        .context("write stdout")?;
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
