import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrgsController } from './orgs.controller';

@Module({
  imports: [AuthModule],
  controllers: [OrgsController],
})
export class OrgsModule {}
