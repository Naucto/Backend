import { ExecutionContext, HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { uuidOf } from '../../../test/uuid';
import { CollectionsController, UserCollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

const ID = '6f1c2f4e-8a53-4c1c-9a57-2f0f6f0d6c11';
const USER = uuidOf(7);
const GAME = uuidOf(12);

describe('collections routes', () => {
  let app: INestApplication;
  /** The account the access guard found on the request; null for a reader who is signed out. */
  let signedIn: { id: string } | null;

  const collections = {
    listPublic: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addGame: jest.fn(),
    removeGame: jest.fn(),
    reorder: jest.fn(),
    listMine: jest.fn(),
    listPublicOf: jest.fn(),
  };
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  beforeEach(async () => {
    jest.resetAllMocks();
    signedIn = { id: USER };

    const module = await Test.createTestingModule({
      controllers: [CollectionsController, UserCollectionsController],
      providers: [
        { provide: CollectionsService, useValue: collections },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (context: ExecutionContext): boolean => {
              context.switchToHttp().getRequest().user = signedIn;
              return true;
            },
          },
        },
      ],
    }).compile();

    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(() => app.close());

  it('opens a collection for the reader a valid token names, or for nobody', async () => {
    collections.findOne.mockResolvedValue({});

    await http().get(`/collections/${ID}`).expect(HttpStatus.OK);
    signedIn = null;
    await http().get(`/collections/${ID}`).expect(HttpStatus.OK);

    expect(collections.findOne.mock.calls).toEqual([
      [ID, USER],
      [ID, null],
    ]);
  });

  it('reads an id in the lower case the database answers ids in', async () => {
    collections.findOne.mockResolvedValue({});

    await http().get(`/collections/${ID.toUpperCase()}`).expect(HttpStatus.OK);

    expect(collections.findOne).toHaveBeenCalledWith(ID, USER);
  });

  it('refuses an id that is not a UUID before reading anything', async () => {
    await http().get('/collections/12').expect(HttpStatus.BAD_REQUEST);
    await http().delete('/collections/12').expect(HttpStatus.BAD_REQUEST);
    await http().put(`/collections/12/games/${GAME}`).expect(HttpStatus.BAD_REQUEST);
    await http().put(`/collections/${ID}/games/3`).expect(HttpStatus.BAD_REQUEST);
    await http().get('/users/public/3/collections').expect(HttpStatus.BAD_REQUEST);

    expect(collections.findOne).not.toHaveBeenCalled();
    expect(collections.remove).not.toHaveBeenCalled();
    expect(collections.addGame).not.toHaveBeenCalled();
    expect(collections.listPublicOf).not.toHaveBeenCalled();
  });

  it('creates a collection for the caller', async () => {
    collections.create.mockResolvedValue({ id: ID });
    const body = { title: 'Couch co-op', description: 'Side by side.', visibility: 'UNLISTED' };

    await http().post('/collections').send(body).expect(HttpStatus.CREATED);

    expect(collections.create).toHaveBeenCalledWith(USER, body);
  });

  it.each([
    ['no title', {}],
    ['an empty title', { title: '' }],
    ['a title over 40 characters', { title: 'x'.repeat(41) }],
    ['a description over 280 characters', { title: 'Fine', description: 'x'.repeat(281) }],
    ['a visibility it does not know', { title: 'Fine', visibility: 'FRIENDS' }],
    ['an owner', { title: 'Fine', ownerId: uuidOf(1) }],
  ])('refuses to create one with %s', async (_case, body) => {
    await http().post('/collections').send(body).expect(HttpStatus.BAD_REQUEST);

    expect(collections.create).not.toHaveBeenCalled();
  });

  it('accepts a title of 40 characters and a description of 280', async () => {
    collections.create.mockResolvedValue({ id: ID });

    await http()
      .post('/collections')
      .send({ title: 'x'.repeat(40), description: 'x'.repeat(280) })
      .expect(HttpStatus.CREATED);
  });

  it('updates only what the body names', async () => {
    collections.update.mockResolvedValue({ id: ID });

    await http().patch(`/collections/${ID}`).send({ visibility: 'PUBLIC' }).expect(HttpStatus.OK);
    await http()
      .patch(`/collections/${ID}`)
      .send({ title: 'x'.repeat(41) })
      .expect(HttpStatus.BAD_REQUEST);

    expect(collections.update.mock.calls).toEqual([[ID, USER, { visibility: 'PUBLIC' }]]);
  });

  it('deletes, adds a game and removes one without a body to answer', async () => {
    await http().delete(`/collections/${ID}`).expect(HttpStatus.NO_CONTENT);
    await http().put(`/collections/${ID}/games/${GAME}`).expect(HttpStatus.NO_CONTENT);
    await http().delete(`/collections/${ID}/games/${GAME}`).expect(HttpStatus.NO_CONTENT);

    expect(collections.remove).toHaveBeenCalledWith(ID, USER);
    expect(collections.addGame).toHaveBeenCalledWith(ID, USER, GAME);
    expect(collections.removeGame).toHaveBeenCalledWith(ID, USER, GAME);
  });

  it('reorders from the whole list of games', async () => {
    await http()
      .put(`/collections/${ID}/games`)
      .send({ projectIds: [GAME, uuidOf(4), uuidOf(31)] })
      .expect(HttpStatus.NO_CONTENT);

    expect(collections.reorder).toHaveBeenCalledWith(ID, USER, [GAME, uuidOf(4), uuidOf(31)]);
  });

  it.each([
    ['no list', {}],
    ['a game named twice', { projectIds: [uuidOf(4), uuidOf(4)] }],
    ['something that is not a game id', { projectIds: ['four'] }],
    [
      'more games than a collection holds',
      { projectIds: Array.from({ length: 201 }, (_, i) => uuidOf(i)) },
    ],
  ])('refuses to reorder from %s', async (_case, body) => {
    await http().put(`/collections/${ID}/games`).send(body).expect(HttpStatus.BAD_REQUEST);

    expect(collections.reorder).not.toHaveBeenCalled();
  });

  it('pages the public list, reading the page and the sort off the query', async () => {
    collections.listPublic.mockResolvedValue({ collections: [], total: 0, page: 2, limit: 12 });
    signedIn = null;

    await http()
      .get('/collections')
      .query({ page: 2, limit: 12, sort: 'games' })
      .expect(HttpStatus.OK);

    expect(collections.listPublic).toHaveBeenCalledWith({ page: 2, limit: 12, sort: 'games' });
  });

  it('refuses a page it cannot serve: an unknown sort, a size beyond the cap', async () => {
    await http().get('/collections').query({ sort: 'best' }).expect(HttpStatus.BAD_REQUEST);
    await http().get('/collections').query({ limit: 101 }).expect(HttpStatus.BAD_REQUEST);

    expect(collections.listPublic).not.toHaveBeenCalled();
  });

  it("lists the caller's collections, about a game when one is asked about", async () => {
    collections.listMine.mockResolvedValue([]);

    await http().get('/users/me/collections').expect(HttpStatus.OK);
    await http().get('/users/me/collections').query({ projectId: GAME }).expect(HttpStatus.OK);
    await http()
      .get('/users/me/collections')
      .query({ projectId: 'twelve' })
      .expect(HttpStatus.BAD_REQUEST);

    expect(collections.listMine.mock.calls).toEqual([
      [USER, undefined],
      [USER, GAME],
    ]);
  });

  it("lists a user's public collections to anyone", async () => {
    collections.listPublicOf.mockResolvedValue([]);
    signedIn = null;

    await http()
      .get(`/users/public/${uuidOf(3)}/collections`)
      .expect(HttpStatus.OK);

    expect(collections.listPublicOf).toHaveBeenCalledWith(uuidOf(3));
  });
});
