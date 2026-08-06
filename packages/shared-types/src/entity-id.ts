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

/** Current analyzer_version stamped on parse artifacts / appearances. */
export const ANALYZER_VERSION = '0.1.0';
