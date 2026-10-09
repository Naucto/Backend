import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  AnalyticsBeatDto,
  AnalyticsEventsDto,
  AnalyticsPingDto,
  AnalyticsPlayDto,
  ROUTE_PATTERN,
} from './analytics-ingest.dto';

const VISITOR = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';

/** The property paths the validator complains about, as the global pipe would see them. */
function invalid<T extends object>(type: new () => T, body: unknown): string[] {
  const errors = validateSync(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const paths: string[] = [];
  const walk = (list: typeof errors, prefix: string): void => {
    for (const error of list) {
      const path = prefix ? `${prefix}.${error.property}` : error.property;
      if (error.constraints) {
        paths.push(path);
      }
      walk(error.children ?? [], path);
    }
  };
  walk(errors, '');
  return paths;
}

const pageView = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventId: EVENT,
  type: 'PAGE_VIEW',
  ageMs: 0,
  route: 'play/:id',
  ...overrides,
});

describe('analytics ingest DTOs', () => {
  describe('routes', () => {
    it.each(['hub', 'play/:id', 'edit/:id/code', 'settings/:tab', 'hub/all/:row', 'not-found'])(
      'accepts the route template %s',
      (route) => {
        expect(ROUTE_PATTERN.test(route)).toBe(true);
      },
    );

    it.each(['/hub', 'play/42?x=1', 'Hub', 'play//x', '', 'a/:', 'oauth/callback#token'])(
      'refuses %p',
      (route) => {
        expect(ROUTE_PATTERN.test(route)).toBe(false);
      },
    );
  });

  it('accepts a batch of page views with its context', () => {
    expect(
      invalid(AnalyticsEventsDto, {
        visitorId: VISITOR,
        sessionId: SESSION,
        context: { referrer: 'https://example.org', viewportWidth: 1280 },
        events: [pageView()],
      }),
    ).toEqual([]);
  });

  it('refuses more than fifty events in a batch', () => {
    const events = Array.from({ length: 51 }, () => pageView());

    expect(invalid(AnalyticsEventsDto, { visitorId: VISITOR, sessionId: SESSION, events })).toEqual(
      ['events'],
    );
  });

  it('refuses identities that are not version 4 uuids, and unknown fields', () => {
    expect(
      invalid(AnalyticsEventsDto, {
        visitorId: 'visitor-1',
        sessionId: SESSION,
        userId: 5,
        events: [],
      }).sort(),
    ).toEqual(['userId', 'visitorId']);
  });

  it('checks every event of a batch', () => {
    expect(
      invalid(AnalyticsEventsDto, {
        visitorId: VISITOR,
        sessionId: SESSION,
        events: [pageView({ route: '/hub' }), pageView({ type: 'CLICK', ageMs: -1 })],
      }).sort(),
    ).toEqual(['events.0.route', 'events.1.ageMs', 'events.1.type']);
  });

  it('refuses a play report without what is needed to create the play', () => {
    expect(
      invalid(AnalyticsPlayDto, {
        visitorId: VISITOR,
        sessionId: SESSION,
        phase: 'END',
        play: { playId: EVENT, activeMs: 1_000 },
      }).sort(),
    ).toEqual(['play.continued', 'play.releaseId']);
  });

  it('accepts a beat with or without a play', () => {
    expect(
      invalid(AnalyticsBeatDto, { visitorId: VISITOR, sessionId: SESSION, state: 'BROWSING' }),
    ).toEqual([]);
    expect(
      invalid(AnalyticsBeatDto, {
        visitorId: VISITOR,
        sessionId: SESSION,
        state: 'PLAYING',
        releaseId: 4,
        play: { playId: EVENT, releaseId: 4, continued: false, activeMs: 45_000 },
      }),
    ).toEqual([]);
  });

  it('keeps a ping free of any identifier', () => {
    expect(
      invalid(AnalyticsPingDto, {
        kind: 'BEAT',
        state: 'PLAYING',
        signedIn: false,
        visitorId: VISITOR,
      }),
    ).toEqual(['visitorId']);
  });

  it('bounds the running time one ping may carry', () => {
    expect(
      invalid(AnalyticsPingDto, {
        kind: 'FLUSH',
        state: 'PLAYING',
        signedIn: false,
        playMs: 65_001,
      }),
    ).toEqual(['playMs']);
  });
});
