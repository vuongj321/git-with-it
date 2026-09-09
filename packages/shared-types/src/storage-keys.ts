/**
 * Object-store key layout (Phase 5 tenancy).
 * Canonical: `orgs/{orgId}/repos/{repoId}/...`
 * Legacy (pre-Phase 5) keys are still accepted on read for migration.
 */

export function orgRepoPrefix(orgId: string, repoId: string): string {
  return `orgs/${orgId}/repos/${repoId}`;
}

export function bareArchiveKey(
  orgId: string,
  repoId: string,
  ext: 'tar.zst' | 'tar.gz',
): string {
  return `${orgRepoPrefix(orgId, repoId)}/bare.${ext}`;
}

export function graphSnapshotKey(orgId: string, repoId: string, sha: string): string {
  return `${orgRepoPrefix(orgId, repoId)}/graphs/${sha}.json`;
}

export function graphDeltaKey(
  orgId: string,
  repoId: string,
  fromSha: string,
  toSha: string,
): string {
  return `${orgRepoPrefix(orgId, repoId)}/deltas/${fromSha}-${toSha}.json.gz`;
}

export function graphCheckpointKey(orgId: string, repoId: string, sha: string): string {
  return `${orgRepoPrefix(orgId, repoId)}/checkpoints/${sha}.json.gz`;
}

/** Content-addressed parse cache scoped by org (not shared across tenants). */
export function blobParseKey(orgId: string, oid: string, zstd: boolean): string {
  return `orgs/${orgId}/blobs/${oid}.parse.json.${zstd ? 'zst' : 'gz'}`;
}

/** Ordered candidate keys for reads (canonical first, then legacy). */
export function graphSnapshotCandidates(
  orgId: string,
  repoId: string,
  sha: string,
): string[] {
  return [
    graphSnapshotKey(orgId, repoId, sha),
    `repos/${repoId}/graphs/${sha}.json`,
    `graphs/${repoId}/snapshots/${sha}.json`,
  ];
}

export function bareArchiveCandidates(
  orgId: string,
  repoId: string,
  ext: 'tar.zst' | 'tar.gz',
): string[] {
  return [bareArchiveKey(orgId, repoId, ext), `repos/${repoId}/bare.${ext}`];
}

export function blobParseCandidates(orgId: string, oid: string, zstd: boolean): string[] {
  const suffix = zstd ? 'zst' : 'gz';
  return [
    blobParseKey(orgId, oid, zstd),
    `blobs/${oid}.parse.json.${suffix}`,
  ];
}
