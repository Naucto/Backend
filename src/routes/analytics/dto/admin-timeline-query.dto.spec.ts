import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { AnalyticsReleasesQueryDto, AnalyticsTimelineQueryDto } from './admin-timeline-query.dto';
import { CreateAnalyticsMarkerDto } from './analytics-marker.dto';

function invalid<T extends object>(type: new () => T, body: unknown): string[] {
  return validateSync(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

const RANGE = { from: '2026-10-20T18:00:00Z', to: '2026-10-21T18:00:00Z' };

describe('the timeline query', () => {
  it('reads its metrics from a comma-separated list', () => {
    const query = plainToInstance(AnalyticsTimelineQueryDto, {
      ...RANGE,
      metrics: 'visitors_new,plays_anonymous',
      releaseId: '9',
    });

    expect(query.metrics).toEqual(['visitors_new', 'plays_anonymous']);
    expect(query.releaseId).toBe(9);
    expect(validateSync(query)).toEqual([]);
  });

  it('refuses an unknown metric, bucket or source', () => {
    expect(invalid(AnalyticsTimelineQueryDto, { ...RANGE, metrics: 'visitors,plays' })).toEqual([
      'metrics',
    ]);
    expect(invalid(AnalyticsTimelineQueryDto, { ...RANGE, bucket: '2m' })).toEqual(['bucket']);
    expect(invalid(AnalyticsTimelineQueryDto, { ...RANGE, source: 'country:FR' })).toEqual([
      'source',
    ]);
  });

  it('refuses a day where an instant is expected', () => {
    expect(invalid(AnalyticsTimelineQueryDto, { from: 'yesterday', to: RANGE.to })).toEqual([
      'from',
    ]);
  });
});

describe('the game search query', () => {
  it('reads ids from a comma-separated list', () => {
    const query = plainToInstance(AnalyticsReleasesQueryDto, { ids: '12,40', limit: '5' });

    expect(query.ids).toEqual([12, 40]);
    expect(query.limit).toBe(5);
    expect(validateSync(query)).toEqual([]);
    expect(invalid(AnalyticsReleasesQueryDto, { ids: '12,x' })).toEqual(['ids']);
    expect(invalid(AnalyticsReleasesQueryDto, { limit: '500' })).toEqual(['limit']);
  });
});

describe('a new marker', () => {
  it('takes only http and https links', () => {
    const marker = { at: RANGE.from, label: 'Trailer' };

    expect(invalid(CreateAnalyticsMarkerDto, { ...marker, url: 'https://youtu.be/x' })).toEqual([]);
    expect(invalid(CreateAnalyticsMarkerDto, { ...marker, url: 'javascript:alert(1)' })).toEqual([
      'url',
    ]);
    expect(invalid(CreateAnalyticsMarkerDto, { ...marker, url: 'youtu.be/x' })).toEqual(['url']);
  });

  it('speaks to players, creators or everyone, and nobody else', () => {
    const marker = { at: RANGE.from, label: 'Trailer' };

    expect(invalid(CreateAnalyticsMarkerDto, { ...marker, audience: 'CREATORS' })).toEqual([]);
    expect(invalid(CreateAnalyticsMarkerDto, { ...marker, audience: 'INVESTORS' })).toEqual([
      'audience',
    ]);
  });

  it('needs a label', () => {
    expect(invalid(CreateAnalyticsMarkerDto, { at: RANGE.from, label: '' })).toEqual(['label']);
  });
});
