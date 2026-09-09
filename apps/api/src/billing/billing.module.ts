import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { QuotasService } from './quotas.service';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class BillingModule {}
