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
        #[arg(long)]
        url: String,
        #[arg(long)]
        path: PathBuf,
        #[arg(long)]
        branch: Option<String>,
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
        #[arg(long)]
        prefix: Option<String>,
    },
    /// Print blob contents for an OID (or `sha:path`) to stdout
    CatFile {
        #[arg(long)]
        path: PathBuf,
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
    /// Walk first-parent history tip→past. JSONL lines:
    /// {"sha","parents":[],"authored_at","message"}
    LogFirstParent {
        #[arg(long)]
        path: PathBuf,
        /// Starting rev (default HEAD)
        #[arg(long, default_value = "HEAD")]
        rev: String,
        /// Max commits to walk (0 = unbounded)
        #[arg(long, default_value_t = 0)]
        max: usize,
    },
    /// Diff two trees with rename detection (-M). JSONL:
    /// {"status":"A|M|D|R","path","old_path","new_oid","old_oid","score"}
    DiffTree {
        #[arg(long)]
        path: PathBuf,
        /// Parent/from commit (omit or empty for empty tree vs --to)
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: String,
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
        Commands::LogFirstParent { path, rev, max } => cmd_log_first_parent(path, rev, max),
        Commands::DiffTree { path, from, to } => cmd_diff_tree(path, from, to),
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

fn cmd_log_first_parent(path: PathBuf, rev: String, max: usize) -> Result<()> {
    // %H sha, %P parents, %aI author date ISO, %B body (subject+body) — use %s for subject only
    // Record separator 0x1e between commits; field sep 0x1f
    let mut args = vec![
        "log".to_string(),
        "--first-parent".to_string(),
        "--format=%H%x1f%P%x1f%aI%x1f%s".to_string(),
        rev,
    ];
    if max > 0 {
        args.insert(1, format!("-n{max}"));
    }
    let out = git_output_args(&path, &args)?;
    for line in out.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\u{1f}').collect();
        if parts.len() < 4 {
            continue;
        }
        let sha = parts[0];
        let parents: Vec<&str> = parts[1]
            .split_whitespace()
            .filter(|p| !p.is_empty())
            .collect();
        let authored = parts[2];
        let message = parts[3].replace('\\', "\\\\").replace('"', "\\\"");
        let parents_json = parents
            .iter()
            .map(|p| format!("\"{p}\""))
            .collect::<Vec<_>>()
            .join(",");
        println!(
            "{{\"sha\":\"{sha}\",\"parents\":[{parents_json}],\"authored_at\":\"{authored}\",\"message\":\"{message}\"}}"
        );
    }
    Ok(())
}

fn cmd_diff_tree(path: PathBuf, from: Option<String>, to: String) -> Result<()> {
    // --raw -z -M: NUL-separated raw diff with renames
    let mut args = vec![
        "diff-tree".to_string(),
        "-r".to_string(),
        "-M".to_string(),
        "--raw".to_string(),
        "-z".to_string(),
    ];
    if let Some(f) = from.filter(|s| !s.is_empty()) {
        args.push(f);
    } else {
        // Empty tree
        args.push("4b825dc642cb6eb9a060e54bf8d6927bfb56357591".to_string());
    }
    args.push(to);
    let out = git_output_args(&path, &args)?;
    // Format with -z: lines like ":oldmode newmode oldoid newoid status\0path\0" or
    // for rename ":...\0score\0oldpath\0newpath\0" — actually raw -z:
    // Each record: `:<old_mode> <new_mode> <old_sha> <new_sha> <status>\0<path>\0`
    // Rename: status is R###, then path is old\0new
    let bytes = out.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // find start ':'
        while i < bytes.len() && bytes[i] != b':' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let meta_start = i + 1;
        let mut meta_end = meta_start;
        while meta_end < bytes.len() && bytes[meta_end] != 0 {
            meta_end += 1;
        }
        if meta_end >= bytes.len() {
            break;
        }
        let meta = std::str::from_utf8(&bytes[meta_start..meta_end]).unwrap_or("");
        // meta: "100644 100644 oid oid M" or "100644 100644 oid oid R095"
        let parts: Vec<&str> = meta.split_whitespace().collect();
        if parts.len() < 5 {
            i = meta_end + 1;
            continue;
        }
        let old_oid = parts[2];
        let new_oid = parts[3];
        let status_raw = parts[4];
        let status_char = status_raw.chars().next().unwrap_or('M');
        let score: Option<u32> = if status_char == 'R' || status_char == 'C' {
            status_raw.get(1..).and_then(|s| s.parse().ok())
        } else {
            None
        };

        i = meta_end + 1;
        let path1_start = i;
        while i < bytes.len() && bytes[i] != 0 {
            i += 1;
        }
        let path1 = std::str::from_utf8(&bytes[path1_start..i]).unwrap_or("");
        i += 1; // skip NUL

        let (old_path, path, status) = if status_char == 'R' || status_char == 'C' {
            let path2_start = i;
            while i < bytes.len() && bytes[i] != 0 {
                i += 1;
            }
            let path2 = std::str::from_utf8(&bytes[path2_start..i]).unwrap_or("");
            i += 1;
            (
                Some(path1.to_string()),
                path2.to_string(),
                status_char.to_string(),
            )
        } else {
            (None, path1.to_string(), status_char.to_string())
        };

        let old_path_json = match &old_path {
            Some(p) => format!("\"{}\"", json_escape(p)),
            None => "null".to_string(),
        };
        let score_json = match score {
            Some(s) => s.to_string(),
            None => "null".to_string(),
        };
        println!(
            "{{\"status\":\"{status}\",\"path\":\"{}\",\"old_path\":{old_path_json},\"old_oid\":\"{old_oid}\",\"new_oid\":\"{new_oid}\",\"score\":{score_json}}}",
            json_escape(&path)
        );
    }
    Ok(())
}

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
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
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    git_output_args(cwd, &owned)
}

fn git_output_args(cwd: &PathBuf, args: &[String]) -> Result<String> {
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
