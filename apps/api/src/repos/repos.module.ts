import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { JobsModule } from '../jobs/jobs.module';
import { InternalController } from './internal.controller';
import { ReposController } from './repos.controller';

@Module({
  imports: [AuthModule, JobsModule, BillingModule],
  controllers: [ReposController, InternalController],
})
export class ReposModule {}
