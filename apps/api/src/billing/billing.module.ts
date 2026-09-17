import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { QuotasService } from './quotas.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [BillingController],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class BillingModule {}
