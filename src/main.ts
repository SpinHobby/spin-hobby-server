import './load-env.js';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { trustProxyHops } from './config/env.js';
import { initSentry } from './integrations/sentry/sentry.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  await initSentry();
  // rawBody: webhook signatures are computed over the exact bytes Square/PayPal sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set('trust proxy', trustProxyHops());
  configureApp(app);
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Spin Hobby API listening on :${port}`, 'Bootstrap');
}
await bootstrap();
