import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, getSchemaPath, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import * as express from 'express';
import { join } from 'path';

import {
  AUTHENTICATION_REQUIRED,
  PUBLIC_OPERATION_EXTENSION,
} from './auth/access/access.decorators';
import {
  NOTIFICATION_CLIENT_MESSAGES,
  NOTIFICATION_SERVER_MESSAGES,
} from './notifications/dto/notification-message.dto';
import {
  GAME_TABLE_CLIENT_MESSAGES,
  GAME_TABLE_SERVER_MESSAGES,
} from './webrtc/server/webrtc.server.synced-game-table.dto';

/** WebSocket messages no route references, one union per channel and direction. */
const WEBSOCKET_MESSAGE_UNIONS: Record<string, Record<string, new () => object>> = {
  GameTableClientMessage: GAME_TABLE_CLIENT_MESSAGES,
  GameTableServerMessage: GAME_TABLE_SERVER_MESSAGES,
  NotificationClientMessage: NOTIFICATION_CLIENT_MESSAGES,
  NotificationServerMessage: NOTIFICATION_SERVER_MESSAGES,
};

export function messageUnionSchema(messages: Record<string, new () => object>): SchemaObject {
  const entries = Object.entries(messages);

  return {
    oneOf: entries.map(([, message]) => ({ $ref: getSchemaPath(message) })),
    discriminator: {
      propertyName: 'type',
      mapping: Object.fromEntries(entries.map(([type, message]) => [type, getSchemaPath(message)])),
    },
  };
}

/**
 * A public operation never refuses for want of a token (its own 401s, bad credentials, stay), and
 * takes a bearer token without requiring one.
 */
export function statePublicOperations(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (
        typeof operation !== 'object' ||
        operation === null ||
        !(PUBLIC_OPERATION_EXTENSION in operation)
      ) {
        continue;
      }
      const publicOperation = operation as Record<string, unknown> & {
        responses?: Record<string, unknown>;
      };
      delete publicOperation[PUBLIC_OPERATION_EXTENSION];
      const unauthorized = publicOperation.responses?.['401'] as
        | { description?: string }
        | undefined;
      if (unauthorized?.description === AUTHENTICATION_REQUIRED) {
        delete publicOperation.responses?.['401'];
      }
      publicOperation['security'] = [{}, { 'JWT-auth': [] }];
    }
  }
}

export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Naucto API')
    .setDescription('The Naucto API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT : Bearer <token>',
      },
      'JWT-auth',
    )
    .build();

  const unions = Object.entries(WEBSOCKET_MESSAGE_UNIONS);
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: unions.flatMap(([, messages]) => Object.values(messages)),
  });

  statePublicOperations(document);

  document.components ??= {};
  document.components.schemas ??= {};
  for (const [name, messages] of unions) {
    document.components.schemas[name] = messageUnionSchema(messages);
  }

  return document;
}

export function setupSwagger(app: INestApplication): void {
  const document = buildSwaggerDocument(app);

  app.use('/swagger-ui', express.static(join(process.cwd(), 'node_modules', 'swagger-ui-dist')));

  SwaggerModule.setup('swagger', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      url: '/swagger-json',
      layout: 'BaseLayout',
    },
    customSiteTitle: 'Naucto API Docs',
    customCssUrl: '/swagger-ui/swagger-ui.css',
    customJs: ['/swagger-ui/swagger-ui-bundle.js', '/swagger-ui/swagger-ui-standalone-preset.js'],
  });
}
