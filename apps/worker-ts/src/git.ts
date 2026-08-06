import { spawn } from 'node:child_process';
import { env } from './env';

export function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
    }, opts.timeoutMs ?? env.CLONE_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

export async function gwiGit(args: string[]) {
  try {
    return await runCommand(env.GWI_GIT_BIN, args);
  } catch (err) {
    // Fall back to system git if gwi-git is not on PATH (dev without Rust build)
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('ENOENT') && !message.includes('not found')) {
      throw err;
    }
    return runGitFallback(args);
  }
}

async function runGitFallback(args: string[]) {
  // Translate gwi-git CLI → git
  if (args[0] === 'clone') {
    const url = flagValue(args, '--url');
    const path = flagValue(args, '--path');
    const branch = flagValue(args, '--branch');
    const token = flagValue(args, '--token');
    if (!url || !path) throw new Error('clone requires --url and --path');
    const authUrl = injectToken(url, token);
    const gitArgs = ['clone', '--bare'];
    if (branch) gitArgs.push(`--branch=${branch}`);
    gitArgs.push(authUrl, path);
    return runCommand('git', gitArgs);
  }
  if (args[0] === 'fetch') {
    const path = flagValue(args, '--path');
    if (!path) throw new Error('fetch requires --path');
    return runCommand('git', ['-C', path, 'fetch', '--all', '--prune']);
  }
  if (args[0] === 'blob-oid') {
    const path = flagValue(args, '--path');
    const sha = flagValue(args, '--sha');
    const file = flagValue(args, '--file');
    if (!path || !sha || !file) throw new Error('blob-oid requires --path --sha --file');
    return runCommand('git', ['-C', path, 'rev-parse', `${sha}:${file}`]);
  }
  if (args[0] === 'ls-tree') {
    const path = flagValue(args, '--path');
    const sha = flagValue(args, '--sha');
    if (!path || !sha) throw new Error('ls-tree requires --path --sha');
    return runCommand('git', ['-C', path, 'ls-tree', '-r', '--name-only', sha]);
  }
  if (args[0] === 'cat-file') {
    const path = flagValue(args, '--path');
    const oid = flagValue(args, '--oid');
    if (!path || !oid) throw new Error('cat-file requires --path --oid');
    return runCommand('git', ['-C', path, 'cat-file', '-p', oid]);
  }
  if (args[0] === 'rev-parse') {
    const path = flagValue(args, '--path');
    const rev = flagValue(args, '--rev') ?? 'HEAD';
    if (!path) throw new Error('rev-parse requires --path');
    return runCommand('git', ['-C', path, 'rev-parse', rev]);
  }
  throw new Error(`Unsupported gwi-git args: ${args.join(' ')}`);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function injectToken(url: string, token?: string) {
  if (!token) return url;
  const u = new URL(url);
  u.username = 'x-access-token';
  u.password = token;
  return u.toString();
}
