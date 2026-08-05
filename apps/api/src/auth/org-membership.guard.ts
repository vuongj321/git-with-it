import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { db } from '../db/client';
import { memberships } from '../db/schema';
import { ORG_ID_PARAM_KEY } from './org.decorator';

@Injectable()
export class OrgMembershipGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new UnauthorizedException();
    }

    // Service token bypasses org checks (integration / worker callbacks)
    if (req.user.email === 'service@git-with-it.local') {
      return true;
    }

    const paramName =
      this.reflector.getAllAndOverride<string>(ORG_ID_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'orgId';

    const orgId =
      (req.params[paramName] as string | undefined) ??
      (req.body?.orgId as string | undefined) ??
      (req.query.orgId as string | undefined);

    if (!orgId) {
      throw new ForbiddenException('orgId required');
    }

    const rows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, req.user.userId)))
      .limit(1);

    if (!rows[0]) {
      throw new ForbiddenException('Not a member of this organization');
    }

    return true;
  }
}
