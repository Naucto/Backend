import { OpenAPIObject } from '@nestjs/swagger';
import { OperationObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

import {
  AUTHENTICATION_REQUIRED,
  PUBLIC_OPERATION_EXTENSION,
} from './auth/access/access.decorators';
import { messageUnionSchema, statePublicOperations } from './swagger';

function documentWith(operation: Record<string, unknown>): OpenAPIObject {
  const get = { responses: {}, ...operation } as OperationObject;
  return {
    openapi: '3.0.0',
    info: { title: 'test', version: '1' },
    paths: { '/thing': { get } },
  };
}

describe('statePublicOperations', () => {
  it('drops the 401 a protected controller lends its public routes, and makes the bearer optional', () => {
    const document = documentWith({
      [PUBLIC_OPERATION_EXTENSION]: true,
      responses: { '200': {}, '401': { description: AUTHENTICATION_REQUIRED } },
      security: [{ 'JWT-auth': [] }],
    });

    statePublicOperations(document);

    const operation = document.paths['/thing']?.get;
    expect(operation?.responses).toEqual({ '200': {} });
    expect(operation?.security).toEqual([{}, { 'JWT-auth': [] }]);
    expect(operation).not.toHaveProperty(PUBLIC_OPERATION_EXTENSION);
  });

  it("keeps a public route's own 401, which means bad credentials", () => {
    const document = documentWith({
      [PUBLIC_OPERATION_EXTENSION]: true,
      responses: { '401': { description: 'Invalid credentials' } },
    });

    statePublicOperations(document);

    expect(document.paths['/thing']?.get?.responses).toHaveProperty('401');
  });

  it('leaves a protected route as it is', () => {
    const operation = {
      responses: { '401': { description: AUTHENTICATION_REQUIRED } },
      security: [{ 'JWT-auth': [] }],
    };

    const document = documentWith(structuredClone(operation));

    statePublicOperations(document);

    expect(document.paths['/thing']?.get).toEqual(operation);
  });
});

describe('messageUnionSchema', () => {
  class PingMessage {}
  class PongMessage {}

  it('discriminates the messages on their type', () => {
    expect(messageUnionSchema({ ping: PingMessage, pong: PongMessage })).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/PingMessage' },
        { $ref: '#/components/schemas/PongMessage' },
      ],
      discriminator: {
        propertyName: 'type',
        mapping: {
          ping: '#/components/schemas/PingMessage',
          pong: '#/components/schemas/PongMessage',
        },
      },
    });
  });
});
