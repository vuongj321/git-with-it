import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env';

const encoder = new TextEncoder();

function secretKey() {
  return encoder.encode(env.AUTH_SECRET);
}

export type SessionClaims = {
  sub: string;
  email: string;
  name?: string | null;
};

export async function signSessionToken(claims: SessionClaims, expiresIn = '7d') {
  return new SignJWT({ email: claims.email, name: claims.name ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secretKey());
  if (!payload.sub || typeof payload.email !== 'string') {
    throw new Error('Invalid token claims');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

/** Dev-friendly API key derived from AUTH_SECRET for service-to-service smoke tests */
export function isValidServiceToken(token: string): boolean {
  const expected = createHash('sha256').update(`gwi-service:${env.AUTH_SECRET}`).digest('hex');
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function serviceTokenForDev(): string {
  return createHash('sha256').update(`gwi-service:${env.AUTH_SECRET}`).digest('hex');
}
