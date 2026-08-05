import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env';

function keyBytes() {
  return createHash('sha256').update(env.PAT_ENCRYPTION_KEY).digest();
}

/** Encrypt PAT at rest (local KMS stub). Format: iv:ciphertext hex */
export function encryptPat(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptPat(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Invalid encrypted PAT format');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

export function serviceToken(): string {
  return createHash('sha256').update(`gwi-service:${env.AUTH_SECRET}`).digest('hex');
}
