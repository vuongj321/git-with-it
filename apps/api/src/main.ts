import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  // OTel stub — enable when OTEL_EXPORTER_OTLP_ENDPOINT is set (Phase 0 wiring only)
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.log(
      `OTel exporter configured at ${env.OTEL_EXPORTER_OTLP_ENDPOINT} (stub; no SDK started yet)`,
    );
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  // Worker internal posts (insights evidence, commit walks, …) exceed Express’s ~100kb default.
  app.use(json({ limit: env.BODY_JSON_LIMIT }));
  app.use(urlencoded({ limit: env.BODY_JSON_LIMIT, extended: true }));
  app.useLogger(app.get(Logger));
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  const swagger = new DocumentBuilder()
    .setTitle('Git With It API')
    .setDescription('Phase 0 control plane')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(env.API_PORT);
}

bootstrap();
