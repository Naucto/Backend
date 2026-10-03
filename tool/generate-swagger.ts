import { writeFileSync } from "node:fs";
import { setupGracefulShutdown } from "@tygra/nestjs-graceful-shutdown";

// This is only necessary for services that explicitly rely on ConfigService
const stubEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://stub:stub@localhost:5432/stub",
  JWT_SECRET: "stub-secret-for-swagger-generation-only",
  JWT_EXPIRES_IN: "7d",
  JWT_REFRESH_EXPIRES_IN: "30d",
  NODE_ENV: "development",
  FRONTEND_URL: "http://localhost:3001",
  GOOGLE_CLIENT_ID: "stub-google-client-id",
  GOOGLE_CLIENT_SECRET: "stub-google-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/stub",
  GITHUB_CLIENT_ID: "stub-github-client-id",
  GITHUB_CLIENT_SECRET: "stub-github-client-secret",
  MICROSOFT_CLIENT_ID: "stub-microsoft-client-id",
  MICROSOFT_TENANT_ID: "stub-microsoft-tenant-id",
  PORT: "3000",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "stub-region",
  S3_ACCESS_KEY_ID: "stub-key",
  S3_SECRET_ACCESS_KEY: "stub",
  S3_BUCKET_NAME: "stub-bucket",
  S3_MAX_AUTO_HISTORY_VERSION: "5",
  S3_AUTO_HISTORY_DELAY: "10",
  S3_MAX_CHECKPOINTS: "5",
};

Object.assign(process.env, stubEnv);

(async () => {
  try {
    const { NestFactory } = await import("@nestjs/core");
    const { SwaggerAppModule } = await import("../src/swagger.app.module");
    const { buildSwaggerDocument } = await import("../src/swagger");

    const app = await NestFactory.create(SwaggerAppModule, { logger: ["error", "warn", "log", "debug", "verbose"] });
    setupGracefulShutdown({ app });

    const document = buildSwaggerDocument(app);
    writeFileSync("swagger.json", JSON.stringify(document, null, 2));

    await app.close();
    console.log("[swag-gen] swagger.json written");
  } catch (err) {
    console.error(
      "[swag-gen] Failed to generate swagger.json",
      err instanceof Error ? err.stack : String(err)
    );
    process.exit(1);
  }
})();

