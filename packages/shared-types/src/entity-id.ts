/**
 * Deterministic entity IDs (UUIDv5) — see ADR 0006.
 *
 * Namespace = UUIDv5(DNS_NAMESPACE, "git-with-it.entity.v1")
 *   DNS_NAMESPACE = 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *   → 73061f4c-6213-5e3a-a533-3a7162bb434f
 *
 * Do not change GWI_ENTITY_NAMESPACE; existing entity rows depend on it.
 */

import { createHash } from 'node:crypto';

/** Fixed namespace for all Git With It entity UUIDv5 derivations. Never change. */
export const GWI_ENTITY_NAMESPACE = '73061f4c-6213-5e3a-a533-3a7162bb434f';

export type EntityKindForId =
  | 'package'
  | 'file'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'variable';

const ENTITY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`invalid uuid: ${uuid}`);
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buf: Buffer): string {
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** RFC 4122 UUIDv5 from a namespace UUID + name string. */
export function uuidv5(name: string, namespace: string = GWI_ENTITY_NAMESPACE): string {
  const ns = uuidToBytes(namespace);
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // version 5
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // variant RFC 4122
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/** Stable entity id: UUIDv5(namespace, `${repoId}:${kind}:${fqn}`). */
export function entityId(repoId: string, kind: EntityKindForId, fqn: string): string {
  return uuidv5(`${repoId}:${kind}:${fqn}`);
}

/** True when value looks like a Postgres uuid suitable for `entities.id`. */
export function isEntityUuid(value: string): boolean {
  return ENTITY_UUID_RE.test(value);
}

export function kindForEntityId(kind: string): EntityKindForId {
  if (kind === 'package') return 'package';
  if (kind === 'file') return 'file';
  if (kind === 'class') return 'class';
  if (kind === 'interface') return 'interface';
  if (kind === 'function') return 'function';
  if (kind === 'method') return 'method';
  return 'variable';
}

export type GraphEntityRef =
  | string
  | {
      id: string;
      kind: string;
      fqn: string;
    };

/**
 * Map a graph-local node id (`file:…`, `pkg:…`, `sym:…`) or node object to the
 * stable product entity UUID. Already-UUID refs are returned unchanged.
 */
export function graphRefToEntityId(repoId: string, ref: GraphEntityRef): string {
  if (typeof ref !== 'string') {
    return entityId(repoId, kindForEntityId(ref.kind), ref.fqn);
  }
  if (isEntityUuid(ref)) return ref;
  if (ref.startsWith('file:')) {
    return entityId(repoId, 'file', ref.slice('file:'.length));
  }
  if (ref.startsWith('pkg:')) {
    return entityId(repoId, 'package', ref.slice('pkg:'.length));
  }
  if (ref.startsWith('sym:')) {
    // Symbol kind is not encoded in the id; prefer a GraphNode when available.
    return entityId(repoId, 'function', ref.slice('sym:'.length));
  }
  return entityId(repoId, 'file', ref);
}

/** Current analyzer_version stamped on parse artifacts / appearances. */
export const ANALYZER_VERSION = '0.2.0';
