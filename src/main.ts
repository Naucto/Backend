import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { setupSwagger } from './swagger';
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
    new (require('@nestjs/platform-express')).ExpressAdapter(expressApp),
  );

  app.useLogger(['log', 'error', 'warn', 'debug']);
  app.useStaticAssets(path.join(__dirname, '..', 'public'));
  app.setBaseViewsDir(path.join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');

  app.enableCors();

  app.use((req, res, next) => {
    console.log(`${req.method} request for ${req.url}`);
    next();
  });

  setupSwagger(app);

  await app.init();

  const { setupWebSocketServer } = await import('./collab/signaling/signal');
  setupWebSocketServer(server);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap();
