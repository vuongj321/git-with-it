# ADR 0003: Bare clone as tar.zst in object storage

## Status

Accepted (Phase 0)

## Context

Workers need a durable git artifact after clone. Options: git bundle, bare directory upload, or full working tree. Bundles are awkward for incremental `fetch`. Working trees waste space and invite accidental code execution.

## Decision

Store each repository as a **bare git directory archived with zstd** (`repos/{repo_id}/bare.tar.zst`) in MinIO/S3. The `gwi-git` CLI performs `git clone --bare` / `git fetch` only. Local/dev may fall back to `.tar.gz` when `zstd` is unavailable; production images include zstd.

Object key and `repositories.clone_uri` / `last_synced_sha` are updated when the upload completes.

## Consequences

- Re-analyze can download, `git fetch`, and re-upload (Phase 0 re-clones fresh for simplicity; incremental fetch is the intended evolution).
- Never execute repository hooks or build scripts.
- Max size guard (default 2GB) rejects oversized clones early.
