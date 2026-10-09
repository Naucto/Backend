import { AnalyticsGrain } from '@prisma/client';

import { FinalizationClass } from './analytics-metrics';
import { DAY_MS, MINUTE_MS } from './analytics-time';

export type RollupClass = Exclude<FinalizationClass, 'COHORT'>;

export const ROLLUP_CLASSES: readonly RollupClass[] = [
  'ACTIVITY',
  'SESSION',
  'FACT',
  'MULTIPLAYER',
  'PRESENCE',
];

export const GRAINS: readonly AnalyticsGrain[] = ['DAY', 'WEEK', 'MONTH'];

/**
 * How long after its period ends a class stops changing. Reports may arrive up to 15 minutes
 * late, so an hour and five minutes; sessions started on the last day can run 12 hours and idle
 * 35 minutes more, so a day on top.
 */
export const DUE_AFTER_END_MS: Record<RollupClass, number> = {
  ACTIVITY: 65 * MINUTE_MS,
  FACT: 65 * MINUTE_MS,
  MULTIPLAYER: 65 * MINUTE_MS,
  PRESENCE: 65 * MINUTE_MS,
  SESSION: DAY_MS + 65 * MINUTE_MS,
};

export interface Period {
  grain: AnalyticsGrain;
  /** First day, as `YYYY-MM-DD`. */
  start: string;
  /** Day after the last one, as `YYYY-MM-DD`. */
  end: string;
}

const parseDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const formatDay = (at: Date): string => at.toISOString().slice(0, 10);

/** The period of a grain holding a day: the day itself, its ISO week, or its month. */
export function periodOf(grain: AnalyticsGrain, day: string): Period {
  const at = parseDay(day);
  if (grain === 'DAY') {
    return { grain, start: day, end: formatDay(new Date(at.getTime() + DAY_MS)) };
  }
  if (grain === 'WEEK') {
    const sinceMonday = (at.getUTCDay() + 6) % 7;
    const start = new Date(at.getTime() - sinceMonday * DAY_MS);
    return {
      grain,
      start: formatDay(start),
      end: formatDay(new Date(start.getTime() + 7 * DAY_MS)),
    };
  }
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { grain, start: formatDay(start), end: formatDay(end) };
}

/** When a period of a class becomes final. */
export const dueAt = (rollupClass: RollupClass, period: Period): Date =>
  new Date(parseDay(period.end).getTime() + DUE_AFTER_END_MS[rollupClass]);

/** Every period of a grain from the one holding `fromDay` on, in order, that is due at `now`. */
export function duePeriods(
  rollupClass: RollupClass,
  grain: AnalyticsGrain,
  fromDay: string,
  now: Date,
): Period[] {
  const periods: Period[] = [];
  let period = periodOf(grain, fromDay);
  while (dueAt(rollupClass, period) <= now) {
    periods.push(period);
    period = periodOf(grain, period.end);
  }
  return periods;
}
