# Secret scanning on clone

After the bare clone/fetch, the worker scans the clone directory **before** it
uploads the archive: `apps/worker-ts/src/clone.ts` calls `scanSecrets()` in
`apps/worker-ts/src/secret-scan.ts`.

## What it runs

- **gitleaks**, when it is on the worker's `PATH`:
  `gitleaks detect --source <clone-dir> --no-git`.
- Otherwise a **regex fallback** over a fixed set of root files (`README.md`,
  `.env`, `.env.example`, `config.json`, `secrets.yaml`) matching AWS access
  keys, GitHub PATs, Slack tokens, and generic `api_key` / `secret` /
  `password` assignments.

gitleaks is not bundled in the worker image (`apps/worker-ts/Dockerfile`), so
deployments run the fallback unless gitleaks is added to `PATH`.

## Findings

Each finding is `{ rule, file, severity }`; the scanner only emits `high`
severity. The **rule and file** are logged — never the matched value.

## Modes

```text
SECRET_SCAN_MODE=off|warn|block
```

| Mode | Behavior |
|---|---|
| `off` | Skip the scanner |
| `warn` (default) | Scan, log findings, continue |
| `block` | Scan, and fail the run on a high finding |

A blocked clone throws `Secret scan blocked clone (<rules>)`, so the analysis
run fails and no graph is published.

## Notes

- Never echo raw secret values into logs, job payloads, or UI error messages.
- Private-repo PATs are encrypted at rest with AES-256-GCM keyed by
  `PAT_ENCRYPTION_KEY` (`apps/worker-ts/src/crypto.ts`).
