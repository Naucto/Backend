import { bucketFor, bucketStarts, parseSource, windowOf } from './analytics-timeline';

describe('the timeline', () => {
  describe('a window', () => {
    it('aligns its buckets to their size, whatever instants it was asked for', () => {
      const window = windowOf(
        new Date('2026-10-20T18:07:31Z'),
        new Date('2026-10-20T19:01:00Z'),
        '15m',
      );

      expect(window.from.toISOString()).toBe('2026-10-20T18:00:00.000Z');
      expect(window.to.toISOString()).toBe('2026-10-20T19:15:00.000Z');
      expect(bucketStarts(window).map((start) => start.toISOString().slice(11, 16))).toEqual([
        '18:00',
        '18:15',
        '18:30',
        '18:45',
        '19:00',
      ]);
    });

    it('holds at least one bucket', () => {
      const at = new Date('2026-10-20T18:00:00Z');

      expect(bucketStarts(windowOf(at, at, '1h'))).toHaveLength(1);
    });

    it('cuts days at midnight UTC', () => {
      const window = windowOf(
        new Date('2026-10-20T18:00:00Z'),
        new Date('2026-10-22T03:00:00Z'),
        '1d',
      );

      expect(bucketStarts(window).map((start) => start.toISOString())).toEqual([
        '2026-10-20T00:00:00.000Z',
        '2026-10-21T00:00:00.000Z',
        '2026-10-22T00:00:00.000Z',
      ]);
    });
  });

  it('picks the finest bucket that keeps a window readable', () => {
    const hour = 3_600_000;

    expect(bucketFor(2 * hour)).toBe('1m');
    expect(bucketFor(24 * hour)).toBe('5m');
    expect(bucketFor(72 * hour)).toBe('15m');
    expect(bucketFor(14 * 24 * hour)).toBe('1h');
    expect(bucketFor(90 * 24 * hour)).toBe('6h');
  });

  describe('a source', () => {
    it('reads a kind and a value', () => {
      expect(parseSource('referrer:youtube.com')).toEqual({
        kind: 'referrer',
        value: 'youtube.com',
      });
      expect(parseSource('utmCampaign:spring:launch')).toEqual({
        kind: 'utmCampaign',
        value: 'spring:launch',
      });
    });

    it('reads (none) as a session without one, a direct visit for a referrer', () => {
      expect(parseSource('referrer:(none)')).toEqual({ kind: 'referrer', value: null });
    });

    it('refuses an unknown kind or an empty value', () => {
      expect(parseSource('country:FR')).toBeNull();
      expect(parseSource('referrer:')).toBeNull();
      expect(parseSource('youtube.com')).toBeNull();
    });
  });
});
