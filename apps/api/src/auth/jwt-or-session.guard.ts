import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { verifySessionToken, isValidServiceToken, type SessionClaims } from './tokens';

export type AuthUser = SessionClaims & { userId: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

@Injectable()
export class JwtOrSessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtOrSessionAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header) {
      this.logger.warn(`401 missing Authorization on ${req.method} ${req.url}`);
      throw new UnauthorizedException('Missing Bearer token');
    }
    const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
    if (!match) {
      this.logger.warn(
        `401 malformed Authorization (len=${header.length}) on ${req.method} ${req.url}`,
      );
      throw new UnauthorizedException('Authorization header must be Bearer <token>');
    }
    let token = match[1]!;
    if (!token) {
      this.logger.warn(`401 empty Bearer token on ${req.method} ${req.url}`);
      throw new UnauthorizedException('Empty token');
    }
    // Tolerate accidental nested "Bearer <token>" stored in localStorage.
    if (/^bearer\s+/i.test(token)) {
      token = token.replace(/^bearer\s+/i, '').trim();
    }

    if (isValidServiceToken(token)) {
      req.user = {
        userId: '00000000-0000-0000-0000-000000000000',
        sub: '00000000-0000-0000-0000-000000000000',
        email: 'service@git-with-it.local',
        name: 'Service',
      };
      return true;
    }

    try {
      const claims = await verifySessionToken(token);
      req.user = { ...claims, userId: claims.sub };
      return true;
    } catch (err) {
      this.logger.warn(
        `401 invalid JWT (parts=${token.split('.').length}, len=${token.length}) on ${req.method} ${req.url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new UnauthorizedException('Invalid session token');
    }
  }
}
