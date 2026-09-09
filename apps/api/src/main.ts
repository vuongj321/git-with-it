import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  // OTel stub — wire real SDK when exporter endpoint is set
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.log(
      `OTel exporter configured at ${env.OTEL_EXPORTER_OTLP_ENDPOINT} (stub; SDK lands with Temporal cutover)`,
    );
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    rawBody: true,
  });
  // Preserve raw body for GitHub webhook HMAC; JSON for everything else.
  app.use(
    json({
      limit: env.BODY_JSON_LIMIT,
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ limit: env.BODY_JSON_LIMIT, extended: true }));
  app.useLogger(app.get(Logger));
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  const swagger = new DocumentBuilder()
    .setTitle('Git With It API')
    .setDescription('Phase 0–5 control plane')
    .setVersion('0.5.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(env.API_PORT);
}

bootstrap();
