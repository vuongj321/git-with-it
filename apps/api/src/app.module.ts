import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { GithubModule } from './github/github.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { OrgsModule } from './orgs/orgs.module';
import { ReposModule } from './repos/repos.module';
import { env } from './config/env';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        transport:
          env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        redact: ['req.headers.authorization'],
        customProps: (req) => ({
          request_id: req.id,
        }),
      },
    }),
    HealthModule,
    AuthModule,
    OrgsModule,
    ReposModule,
    JobsModule,
    BillingModule,
    GithubModule,
  ],
})
export class AppModule {}
