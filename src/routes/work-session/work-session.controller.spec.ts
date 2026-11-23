import { ExecutionContext, HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkSessionController } from './work-session.controller';
import { WorkSessionService } from './work-session.service';

const SIGNED_IN_USER = uuidOf(7);
// Spelled with letters, so its case can differ between a URL and the database.
const OWN_PROJECT = 'abcdef00-0000-4000-8000-000000000012';

describe('WorkSessionController', () => {
  describe('over HTTP', () => {
    let app: INestApplication;
    const workSessionService = {
      join: jest.fn(),
      leave: jest.fn(),
      kick: jest.fn(),
      getInfo: jest.fn(),
    };
    // The signed-in user collaborates on one project only. The id is matched whatever its case, as
    // Postgres matches a `uuid`.
    const prisma = {
      project: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
          collaborators: where.id.toLowerCase() === OWN_PROJECT ? [{ id: SIGNED_IN_USER }] : [],
        })),
      },
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      const module = await Test.createTestingModule({
        controllers: [WorkSessionController],
        providers: [
          { provide: WorkSessionService, useValue: workSessionService },
          { provide: PrismaService, useValue: prisma },
          {
            provide: APP_GUARD,
            useValue: {
              canActivate: (context: ExecutionContext): boolean => {
                context.switchToHttp().getRequest().user = { id: SIGNED_IN_USER };
                return true;
              },
            },
          },
        ],
      }).compile();

      app = module.createNestApplication({ logger: false });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('lets a collaborator reach their own project', async () => {
      await request(app.getHttpServer())
        .get(`/work-sessions/info/${OWN_PROJECT}`)
        .expect(HttpStatus.OK);

      expect(workSessionService.getInfo).toHaveBeenCalledWith(OWN_PROJECT);
    });

    it('names the project in lower case however the URL spells its id', async () => {
      await request(app.getHttpServer())
        .get(`/work-sessions/info/${OWN_PROJECT.toUpperCase()}`)
        .expect(HttpStatus.OK);

      expect(workSessionService.getInfo).toHaveBeenCalledWith(OWN_PROJECT);
    });

    // A lenient reader would take the user's own project from the head of the segment.
    it.each([
      ['post', `/work-sessions/join/${OWN_PROJECT}.5`, 'join'],
      ['post', `/work-sessions/leave/${OWN_PROJECT}.5`, 'leave'],
      ['post', `/work-sessions/kick/${OWN_PROJECT}.5`, 'kick'],
      ['get', `/work-sessions/info/${OWN_PROJECT}.5`, 'getInfo'],
    ] as const)(
      '%s %s never reaches a project other than the one the guard checked',
      async (verb, path, method) => {
        const pending = request(app.getHttpServer())[verb](path);
        if (method === 'kick') {
          pending.send({ userId: uuidOf(3) });
        }

        const response = await pending;

        expect(workSessionService[method]).not.toHaveBeenCalled();
        expect([HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN]).toContain(response.status);
      },
    );
  });
});
