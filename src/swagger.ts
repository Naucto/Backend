import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import express from "express";
import { dirname } from "path";

export function setupSwagger(app: INestApplication) {
    const config = new DocumentBuilder()
    .setTitle("Naucto API")
    .setDescription("The Naucto API documentation")
    .setVersion("1.0")
    .addBearerAuth(
        {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Enter your JWT : Bearer <token>",
        },
        "JWT-auth",
    )
    .build();

    const document = SwaggerModule.createDocument(app, config);

    const swaggerUiPath = dirname(require.resolve("swagger-ui-dist/package.json"));

    app.use("/swagger-ui", express.static(swaggerUiPath));

    SwaggerModule.setup("swagger", app, document, {
        swaggerOptions: {
            persistAuthorization: true,
            url: "/swagger-json",
        },
        customSiteTitle: "Naucto API Docs",
        customCssUrl: "/swagger-ui/swagger-ui.css",
        customJs: [
            "/swagger-ui/swagger-ui-bundle.js",
            "/swagger-ui/swagger-ui-standalone-preset.js",
        ],
    });
}
