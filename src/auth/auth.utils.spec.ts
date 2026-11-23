import { BadTimeSpanError } from './auth.error';
import { TimeSpan, timespanToMs } from './auth.utils';

describe('timespanToMs', () => {
  it('reads a number as seconds and a suffixed value in its unit', () => {
    expect(timespanToMs(90)).toBe(90_000);
    expect(timespanToMs('15m')).toBe(15 * 60_000);
  });

  it('refuses what is not a time span, under an error of its own', () => {
    expect(() => timespanToMs('soon' as TimeSpan)).toThrow(BadTimeSpanError);
  });
});
