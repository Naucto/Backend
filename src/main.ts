import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { setupGracefulShutdown } from '@tygra/nestjs-graceful-shutdown';
import cookieParser from 'cookie-parser';
import { format } from 'date-fns-tz';
import * as dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module';
import { ViolationValidationPipe } from './common/pipes/violation-validation.pipe';
import { getOptionalEnv } from './config/env';
import { useTextJsonParser } from './routes/analytics/analytics-ingest-paths';
import { setupSwagger } from './swagger';

const isProduction = getOptionalEnv('NODE_ENV') === 'production';

if (isProduction) {
  dotenv.config({ path: '.env.production' });
}

(async () => {
  const expressApp = express();
  // The API sits behind the deployment's reverse proxy on a private network, so the address of
  // the reader is the one that proxy reports, not the proxy's own.
  expressApp.set('trust proxy', 'loopback, linklocal, uniquelocal');

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  setupGracefulShutdown({ app });

  const logger = new Logger('HTTP');
  const frontendUrl = getOptionalEnv('FRONTEND_URL', 'http://localhost:3001');

  app.use(cookieParser());
  // Browsers report usage as JSON sent as text/plain, which needs no preflight, so a report sent
  // as a page closes still leaves.
  useTextJsonParser(app);
  app.useLogger(['log', 'error', 'warn', 'debug']);

  app.useGlobalPipes(
    new ViolationValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: isProduction ? frontendUrl : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const date = format(new Date(), 'dd-MM-yyyy HH:mm:ss.SSS');

    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.log(`[${date}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
    });

    next();
  });
  if (getOptionalEnv('ENABLE_SWAGGER', true)) {
    setupSwagger(app);
  } else {
    logger.log('Swagger disabled (ENABLE_SWAGGER=false)');
  }

  await app.init();

  const port = getOptionalEnv('PORT', 3000);

  await app.listen(port, '0.0.0.0');

  const address = app.getHttpServer().address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : Number(port);

  logger.log(`Server listening on port ${actualPort}`);
})();
