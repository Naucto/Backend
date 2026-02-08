import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

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
    
    SwaggerModule.setup("swagger", app, document, {
        swaggerOptions: {
            persistAuthorization: true,
        },
        customSiteTitle: "Naucto API Docs",
    });
}
