import './load-env.js';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { initSentry } from './integrations/sentry/sentry.js';
import { setupApiDocs } from './app.docs.js';
import { configureApp } from './app.setup.js';
import { apiDocsEnabled, port, trustProxyHops } from './config/app.config.js';
import { validateEnvironment } from './config/validate-env.js';

async function bootstrap() {
  validateEnvironment((message) => Logger.warn(message, 'Config'));
  await initSentry();
  // rawBody: webhook signatures are computed over the exact bytes Square/PayPal sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set('trust proxy', trustProxyHops());
  configureApp(app);
  if (apiDocsEnabled()) setupApiDocs(app);
  await app.listen(port(), '0.0.0.0');
  Logger.log(`Spin Hobby API listening on :${port()}`, 'Bootstrap');
}
await bootstrap();
