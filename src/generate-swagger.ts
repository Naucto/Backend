/* eslint-disable no-console */
// Fine for this file, not part of the main project

process.env["DATABASE_URL"] = "postgresql://stub:stub@localhost:5432/stub";
process.env["JWT_SECRET"] = "stub-secret-for-swagger-generation-only";
process.env["JWT_EXPIRES_IN"] = "7d";
process.env["NODE_ENV"] = "development";
process.env["FRONTEND_URL"] = "http://localhost:3001";

(async () => {
  try {
    const { NestFactory } = await import("@nestjs/core");
    const { SwaggerAppModule: AppModule } = await import("./swagger-app.module");
    const { buildSwaggerDocument } = await import("./swagger");
    const fs = await import("fs");

    const app = await NestFactory.create(AppModule, { logger: false });
    const document = buildSwaggerDocument(app);
    fs.writeFileSync("swagger.json", JSON.stringify(document, null, 2));
    console.log("swagger.json written successfully");
    await app.close();
  } catch (err) {
    console.error("Failed to generate swagger.json", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  }
})();

