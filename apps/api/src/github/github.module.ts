import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { GithubWebhookController } from './github-webhook.controller';

@Module({
  imports: [JobsModule],
  controllers: [GithubWebhookController],
})
export class GithubModule {}
