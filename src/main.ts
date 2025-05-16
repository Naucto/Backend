import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { setupSwagger } from './swagger';
import { format } from 'date-fns-tz';
import { setupWebSocketServer } from './collab/signaling/signal';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as http from 'http';

if (process.env.NODE_ENV === 'production') {
  dotenv.config({ path: '.env.production' });
} else {
  dotenv.config();
}

async function bootstrap() {
  const express = require('express');
  const expressApp = express();

  const server = http.createServer(expressApp);

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new (require('@nestjs/platform-express').ExpressAdapter)(expressApp),
  );

  app.useLogger(['log', 'error', 'warn', 'debug']);
  app.useStaticAssets(path.join(__dirname, '..', 'public'));
  app.setBaseViewsDir(path.join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');

  app.enableCors();

  app.use((req, res, next) => {
    const start = Date.now();
    const date = format(new Date(), 'dd-MM-yyyy HH:mm:ss.SSS');

    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(
        `[${date}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`,
      );
    });

    next();
  });

  setupSwagger(app);

  await app.init();

  setupWebSocketServer(server);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap();
