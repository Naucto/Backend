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
import helmet from "helmet";
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
  const adminPanelUrl = configService.get<string>(
    "ADMIN_PANEL_URL",
    "http://localhost:3002"
  );

  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.useLogger(["log", "error", "warn", "debug"]);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  const allowedOrigins = new Set(
    [frontendUrl, adminPanelUrl].filter((url): url is string => Boolean(url))
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS rejected request from origin: ${origin}`);
        callback(new Error("CORS denied"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"]
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
