# Secret scanning on clone

## Policy

After clone/fetch (before or as part of ingest), run **gitleaks** (or equivalent) over the working tree / archive used for analysis.

| Finding severity | Action |
|---|---|
| High (e.g. cloud keys, private keys, high-entropy tokens matching high-confidence rules) | **Block** analysis when mode is `block`; do not publish graph for that run |
| Medium / low / noisy | **Redact** from logs and artifact metadata; record count/type in run diagnostics; continue unless policy says otherwise |

Never echo raw secret values into application logs, job payloads, or UI error messages.

## Env

```text
SECRET_SCAN_MODE=off|warn|block
```

| Mode | Behavior |
|---|---|
| `off` | Skip scanner (local/dev only; not for prod) |
| `warn` | Scan, log/redact findings, always continue |
| `block` | Scan; fail the run on high-severity findings; warn path for others |

Recommended: `warn` in staging, `block` in production.

## Ops notes

- Pin gitleaks version in the worker image; ship allowlist config for known false positives (docs fixtures).
- Quarantined runs should surface a clear API/UI status (`secret_scan_blocked`) without revealing secret contents.
- Pair with KMS-backed storage for GitHub tokens (threat model).
