import { dueAt, duePeriods, periodOf } from './analytics-periods';

describe('analytics periods', () => {
  it('gives a day its own period, its ISO week from Monday, and its calendar month', () => {
    expect(periodOf('DAY', '2026-10-08')).toEqual({
      grain: 'DAY',
      start: '2026-10-08',
      end: '2026-10-09',
    });
    expect(periodOf('WEEK', '2026-10-08')).toEqual({
      grain: 'WEEK',
      start: '2026-10-05',
      end: '2026-10-12',
    });
    expect(periodOf('WEEK', '2026-10-11')).toEqual({
      grain: 'WEEK',
      start: '2026-10-05',
      end: '2026-10-12',
    });
    expect(periodOf('WEEK', '2026-10-05')).toEqual({
      grain: 'WEEK',
      start: '2026-10-05',
      end: '2026-10-12',
    });
    expect(periodOf('MONTH', '2026-02-14')).toEqual({
      grain: 'MONTH',
      start: '2026-02-01',
      end: '2026-03-01',
    });
    expect(periodOf('MONTH', '2026-12-31')).toEqual({
      grain: 'MONTH',
      start: '2026-12-01',
      end: '2027-01-01',
    });
  });

  it('makes a day final at 01:05 the next morning, and its sessions a day later', () => {
    const day = periodOf('DAY', '2026-10-08');

    expect(dueAt('ACTIVITY', day)).toEqual(new Date('2026-10-09T01:05:00Z'));
    expect(dueAt('SESSION', day)).toEqual(new Date('2026-10-10T01:05:00Z'));
  });

  it('makes a week or a month final once its last day is', () => {
    expect(dueAt('ACTIVITY', periodOf('WEEK', '2026-10-08'))).toEqual(
      new Date('2026-10-12T01:05:00Z'),
    );
    expect(dueAt('FACT', periodOf('MONTH', '2026-10-08'))).toEqual(
      new Date('2026-11-01T01:05:00Z'),
    );
  });

  it('lists every due period from the first day on, in order, and none that is not due', () => {
    const now = new Date('2026-10-04T01:05:00Z');

    expect(duePeriods('ACTIVITY', 'DAY', '2026-10-01', now).map((period) => period.start)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(duePeriods('SESSION', 'DAY', '2026-10-01', now).map((period) => period.start)).toEqual([
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(duePeriods('ACTIVITY', 'WEEK', '2026-10-01', now)).toEqual([]);
  });
});
