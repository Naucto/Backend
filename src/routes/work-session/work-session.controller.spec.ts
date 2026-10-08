import { ExecutionContext, HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../prisma/prisma.service';
import { WorkSessionController } from './work-session.controller';
import { WorkSessionService } from './work-session.service';

const SIGNED_IN_USER = 7;
const OWN_PROJECT = 12;

describe('WorkSessionController', () => {
  describe('over HTTP', () => {
    let app: INestApplication;
    const workSessionService = {
      join: jest.fn(),
      leave: jest.fn(),
      kick: jest.fn(),
      getInfo: jest.fn(),
    };
    // The signed-in user collaborates on one project only.
    const prisma = {
      project: {
        findUnique: jest.fn(async ({ where }: { where: { id: number } }) => ({
          collaborators: where.id === OWN_PROJECT ? [{ id: SIGNED_IN_USER }] : [],
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

    // parseInt reads "12.34e2" as 12, the user's own project; Number reads it as 1234.
    it.each([
      ['post', '/work-sessions/join/12.34e2', 'join'],
      ['post', '/work-sessions/leave/12.34e2', 'leave'],
      ['post', '/work-sessions/kick/12.34e2', 'kick'],
      ['get', '/work-sessions/info/12.34e2', 'getInfo'],
    ] as const)(
      '%s %s never reaches a project other than the one the guard checked',
      async (verb, path, method) => {
        const pending = request(app.getHttpServer())[verb](path);
        if (method === 'kick') {
          pending.send({ userId: 3 });
        }

        const response = await pending;

        expect(workSessionService[method]).not.toHaveBeenCalled();
        expect([HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN]).toContain(response.status);
      },
    );
  });
});
