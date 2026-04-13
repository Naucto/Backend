import { AppModule } from "src/app.module";
import { AppConfig } from "src/app.config";
import {
  NestExpressApplication,
  ExpressAdapter
} from "@nestjs/platform-express";
import { setupSwagger } from "src/swagger";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import express, { Request, Response, NextFunction } from "express";

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";

import { setupGracefulShutdown } from "@tygra/nestjs-graceful-shutdown";

import * as dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { format } from "date-fns-tz";

if (process.env["NODE_ENV"] === "production") {
  dotenv.config({ path: ".env.production" });
} else {
  dotenv.config();
}

(async () => {
  const expressApp = express();

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp)
  );

  setupGracefulShutdown({ app });

  const logger = new Logger("HTTP");
  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>(
    "FRONTEND_URL",
    "http://localhost:3001"
  );

  app.use(cookieParser());
  app.useLogger(["log", "error", "warn", "debug"]);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const date = format(new Date(), "dd-MM-yyyy HH:mm:ss.SSS");

    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.log(
        `[${date}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`
      );
    });

    next();
  });

  setupSwagger(app);

  await app.init();

  const port = configService.get<number>("PORT") || 3000;

  await app.listen(port);

  const address = app.getHttpServer().address();
  const actualPort =
    typeof address === "object" && address !== null
      ? address.port
      : Number(port);

  const appConfig = app.get(AppConfig);
  appConfig.port = actualPort;

  logger.log(`Server listening on port ${actualPort}`);
})();

