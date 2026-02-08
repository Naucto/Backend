import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import {
  NestExpressApplication,
  ExpressAdapter
} from "@nestjs/platform-express";
import { setupSwagger } from "./swagger";
import { format } from "date-fns-tz";
import { setupWebSocketServer } from "./collab/signaling/signal";
import { Logger } from "@nestjs/common";
import express, { Request, Response, NextFunction } from "express";
import { ConfigService } from "@nestjs/config";
import * as path from "path";
import * as dotenv from "dotenv";
import * as http from "http";
import cookieParser from "cookie-parser";

if (process.env["NODE_ENV"] === "production") {
  dotenv.config({ path: ".env.production" });
} else {
  dotenv.config();
}

(async () => {
  const expressApp = express();

  const server = http.createServer(expressApp);

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp)
  );

  const logger = new Logger("HTTP");
  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>(
    "FRONTEND_URL",
    "http://localhost:3000"
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

  app.useStaticAssets(path.join(__dirname, "..", "public"));
  app.setBaseViewsDir(path.join(__dirname, "..", "views"));
  app.setViewEngine("ejs");

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

  setupWebSocketServer(server);

  const PORT = process.env["PORT"] || 3000;
  server.listen(PORT, () => {
    logger.log(`Server listening on port ${PORT}`);
  });
})();
