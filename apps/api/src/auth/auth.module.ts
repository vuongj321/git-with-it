import { Module, forwardRef } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { AuthController } from './auth.controller';
import { JwtOrSessionAuthGuard } from './jwt-or-session.guard';
import { OrgMembershipGuard } from './org-membership.guard';

@Module({
  imports: [forwardRef(() => OrgsModule)],
  controllers: [AuthController],
  providers: [JwtOrSessionAuthGuard, OrgMembershipGuard],
  exports: [JwtOrSessionAuthGuard, OrgMembershipGuard],
})
export class AuthModule {}
