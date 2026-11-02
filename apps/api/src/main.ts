import './env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  for (const k of ['JWT_SECRET', 'QR_SECRET', 'DATABASE_URL']) {
    if (!process.env[k]) throw new Error(`Missing env ${k} — copy apps/api/.env.example to .env`);
  }
  // rawBody: LINE webhook signatures are computed over the exact bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.setGlobalPrefix('api', { exclude: ['uploads/(.*)'] });
  app.use(cookieParser());
  app.set('trust proxy', 'loopback');
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true });
  app.enableShutdownHooks();
  // Hard stop if graceful shutdown stalls (open websockets / keep-alive), so watch-mode restarts never leave an orphan holding the ports.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => setTimeout(() => process.exit(0), 3000).unref());
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API on http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
