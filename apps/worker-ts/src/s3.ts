import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { env } from './env';

export function createS3() {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== false,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });
}

export async function ensureBucket(client: S3Client) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}

export async function uploadFile(
  client: S3Client,
  key: string,
  filePath: string,
  contentType: string,
) {
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    }),
  );
  return `s3://${env.S3_BUCKET}/${key}`;
}

export async function uploadBuffer(
  client: S3Client,
  key: string,
  body: Buffer,
  contentType: string,
) {
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return `s3://${env.S3_BUCKET}/${key}`;
}

export async function objectExists(client: S3Client, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function downloadToFile(client: S3Client, key: string, dest: string) {
  const res = await client.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error(`empty S3 body for ${key}`);
  const body = res.Body as Readable;
  await pipeline(body, createWriteStream(dest));
}

export async function downloadBuffer(client: S3Client, key: string): Promise<Buffer> {
  const res = await client.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error(`empty S3 body for ${key}`);
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/** Parse `s3://bucket/key` → key (assumes configured bucket). */
export function keyFromCloneUri(cloneUri: string): string {
  const prefix = `s3://${env.S3_BUCKET}/`;
  if (cloneUri.startsWith(prefix)) return cloneUri.slice(prefix.length);
  const m = /^s3:\/\/[^/]+\/(.+)$/.exec(cloneUri);
  if (!m) throw new Error(`invalid cloneUri: ${cloneUri}`);
  return m[1]!;
}
