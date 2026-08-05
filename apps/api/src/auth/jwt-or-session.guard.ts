import {
  CanActivate,
  ExecutionContext,
  Injectable,
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
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Empty token');
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
    } catch {
      throw new UnauthorizedException('Invalid session token');
    }
  }
}
