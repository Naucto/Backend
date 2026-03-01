/* eslint-disable no-console */
// Fine for this file, not part of the main project

process.env["DATABASE_URL"] = "postgresql://stub:stub@localhost:5432/stub";
process.env["JWT_SECRET"] = "stub-secret-for-swagger-generation-only";
process.env["JWT_EXPIRES_IN"] = "7d";
process.env["NODE_ENV"] = "development";
process.env["FRONTEND_URL"] = "http://localhost:3001";

(async () => {
  try {
    console.log("[swag-gen] Starting swagger generation...");

    console.log("[swag-gen] Importing @nestjs/core...");
    const { NestFactory } = await import("@nestjs/core");
    console.log("[swag-gen] Imported @nestjs/core.");

    console.log("[swag-gen] Importing SwaggerAppModule...");
    const { SwaggerAppModule: AppModule } = await import("../src/swagger.app.module");
    console.log("[swag-gen] Imported SwaggerAppModule.");

    console.log("[swag-gen] Importing buildSwaggerDocument...");
    const { buildSwaggerDocument } = await import("../src/swagger");
    console.log("[swag-gen] Imported buildSwaggerDocument.");

    const fs = await import("fs");

    console.log("[swag-gen] Creating NestJS application...");
    const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log", "debug", "verbose"] });
    console.log("[swag-gen] NestJS application created.");

    console.log("[swag-gen] Building swagger document...");
    const document = buildSwaggerDocument(app);
    console.log("[swag-gen] Swagger document built.");

    console.log("[swag-gen] Writing swagger.json...");
    fs.writeFileSync("swagger.json", JSON.stringify(document, null, 2));
    console.log("[swag-gen] swagger.json written successfully.");

    console.log("[swag-gen] Closing NestJS application...");
    await app.close();
    console.log("[swag-gen] Done.");
  } catch (err) {
    console.error("[swag-gen] Failed to generate swagger.json", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  }
})();
