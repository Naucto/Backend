import { ExecutionContext, HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HubFeedController } from './hub-feed.controller';
import { HubFeedService } from './hub-feed.service';
import { HUB_SHELF_KEYS_MAX } from './hub-limits';

describe('HubFeedController', () => {
  let app: INestApplication;
  /** The account the access guard found on the request; null for a reader who is signed out. */
  let signedIn: { id: number } | null;

  const hubFeedService = { feed: jest.fn(), shelves: jest.fn(), shelfPage: jest.fn() };
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  beforeEach(async () => {
    jest.resetAllMocks();
    signedIn = null;

    const module = await Test.createTestingModule({
      controllers: [HubFeedController],
      providers: [
        { provide: HubFeedService, useValue: hubFeedService },
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

  it('serves the hub to a reader who is signed out, as nobody', async () => {
    hubFeedService.feed.mockResolvedValue({ day: '2026-11-20', hero: [], shelves: [], more: [] });

    await http().get('/hub').expect(HttpStatus.OK);

    expect(hubFeedService.feed).toHaveBeenCalledWith(null);
  });

  it('serves the hub of the reader a valid token names', async () => {
    signedIn = { id: 7 };
    hubFeedService.feed.mockResolvedValue({ day: '2026-11-20', hero: [], shelves: [], more: [] });

    await http().get('/hub').expect(HttpStatus.OK);

    expect(hubFeedService.feed).toHaveBeenCalledWith(7);
  });

  it('reads the shelves to fetch from one comma-separated list', async () => {
    hubFeedService.shelves.mockResolvedValue([]);

    const response = await http()
      .get('/hub/shelves')
      .query({ keys: 'tag:Action RPG,trending' })
      .expect(HttpStatus.OK);

    expect(hubFeedService.shelves).toHaveBeenCalledWith(['tag:Action RPG', 'trending'], null);
    expect(response.body).toEqual({ shelves: [] });
  });

  it('refuses a request for no shelf, or for more than a scroll fetches', async () => {
    await http().get('/hub/shelves').expect(HttpStatus.BAD_REQUEST);
    await http()
      .get('/hub/shelves')
      .query({ keys: Array.from({ length: HUB_SHELF_KEYS_MAX + 1 }, () => 'popular').join() })
      .expect(HttpStatus.BAD_REQUEST);

    expect(hubFeedService.shelves).not.toHaveBeenCalled();
  });

  it('pages one shelf, reading its key off the path and the page off the query', async () => {
    signedIn = { id: 7 };
    hubFeedService.shelfPage.mockResolvedValue({});

    await http()
      .get('/hub/shelves/tag%3AAction%20RPG')
      .query({ page: 2, limit: 12, sort: 'liked' })
      .expect(HttpStatus.OK);

    expect(hubFeedService.shelfPage).toHaveBeenCalledWith('tag:Action RPG', 7, {
      page: 2,
      limit: 12,
      sort: 'liked',
    });
  });

  it('refuses a page it cannot serve: an unknown sort, a size beyond the cap', async () => {
    await http().get('/hub/shelves/popular').query({ sort: 'best' }).expect(HttpStatus.BAD_REQUEST);
    await http().get('/hub/shelves/popular').query({ limit: 101 }).expect(HttpStatus.BAD_REQUEST);

    expect(hubFeedService.shelfPage).not.toHaveBeenCalled();
  });
});
