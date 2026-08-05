import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { JwtOrSessionAuthGuard } from './jwt-or-session.guard';
import { OrgMembershipGuard } from './org-membership.guard';

@Module({
  controllers: [AuthController],
  providers: [JwtOrSessionAuthGuard, OrgMembershipGuard],
  exports: [JwtOrSessionAuthGuard, OrgMembershipGuard],
})
export class AuthModule {}
