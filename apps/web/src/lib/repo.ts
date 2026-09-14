/** Human-readable repo name from a git remote URL (e.g. `owner/repo`). */
export function repoDisplayName(remoteUrl: string): string {
  const trimmed = remoteUrl.replace(/\.git$/i, '');
  const sshMatch = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
  if (sshMatch) return sshMatch[1];

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    if (parts.length === 1) return parts[0];
  } catch {
    // Not a URL — fall through.
  }

  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}
