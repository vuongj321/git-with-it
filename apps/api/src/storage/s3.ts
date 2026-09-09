import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { GraphDiff, GraphSnapshot } from '@gwi/shared-types';
import { env } from '../config/env';

let client: S3Client | null = null;

export function getS3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== false,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }
  return client;
}

/** Accepts raw object keys or `s3://bucket/key`. */
export function keyFromArtifactUri(uri: string): string {
  const prefix = `s3://${env.S3_BUCKET}/`;
  if (uri.startsWith(prefix)) return uri.slice(prefix.length);
  const m = /^s3:\/\/[^/]+\/(.+)$/.exec(uri);
  if (m) return m[1]!;
  return uri.replace(/^\//, '');
}

export function snapshotKey(repoId: string, sha: string): string {
  return `repos/${repoId}/graphs/${sha}.json`;
}

export async function downloadBuffer(keyOrUri: string): Promise<Buffer> {
  const key = keyFromArtifactUri(keyOrUri);
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error(`empty S3 body for ${key}`);
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

async function decompressZstd(buf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'gwi-zstd-'));
  const input = path.join(dir, 'in.zst');
  const output = path.join(dir, 'out.json');
  try {
    await writeFile(input, buf);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('zstd', ['-d', '-f', '-q', '-o', output, input], {
        stdio: 'ignore',
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`zstd exited with ${code}`));
      });
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function downloadJsonObject<T>(keyOrUri: string): Promise<T> {
  const key = keyFromArtifactUri(keyOrUri);
  const buf = await downloadBuffer(key);
  let json: string;
  if (key.endsWith('.zst')) {
    json = (await decompressZstd(buf)).toString('utf8');
  } else if (key.endsWith('.gz')) {
    json = gunzipSync(buf).toString('utf8');
  } else {
    json = buf.toString('utf8');
  }
  return JSON.parse(json) as T;
}

export async function loadGraphSnapshot(
  repoId: string,
  sha: string,
  artifactUri?: string | null,
): Promise<GraphSnapshot> {
  const key = artifactUri?.trim()
    ? keyFromArtifactUri(artifactUri)
    : snapshotKey(repoId, sha);
  const snap = await downloadJsonObject<GraphSnapshot>(key);
  if (!Array.isArray(snap.nodes) || !Array.isArray(snap.edges)) {
    throw new Error(`invalid graph snapshot at ${key}`);
  }
  return snap;
}

export async function loadGraphDiff(artifactUri: string): Promise<GraphDiff> {
  const diff = await downloadJsonObject<GraphDiff>(artifactUri);
  if (!Array.isArray(diff.edgesAdded) || !Array.isArray(diff.edgesRemoved)) {
    throw new Error(`invalid graph diff at ${artifactUri}`);
  }
  return diff;
}
