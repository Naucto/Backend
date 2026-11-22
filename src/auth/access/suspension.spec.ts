import { currentSuspension } from './suspension';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const BEFORE = new Date('2026-11-18T12:00:00.000Z');
const AFTER = new Date('2026-11-20T12:00:00.000Z');

describe('currentSuspension', () => {
  it('finds none on an account never suspended', () => {
    expect(currentSuspension({ suspendedAt: null, suspendedUntil: null }, NOW)).toBeNull();
  });

  it('holds until its end date', () => {
    expect(currentSuspension({ suspendedAt: BEFORE, suspendedUntil: AFTER }, NOW)).toEqual({
      since: BEFORE,
      until: AFTER,
    });
  });

  it('holds with no end date until staff lift it', () => {
    expect(currentSuspension({ suspendedAt: BEFORE, suspendedUntil: null }, NOW)).toEqual({
      since: BEFORE,
      until: null,
    });
  });

  it.each([
    ['past', BEFORE],
    ['reached this instant', NOW],
  ])('lifts itself once its end date is %s', (_case, until) => {
    expect(currentSuspension({ suspendedAt: BEFORE, suspendedUntil: until }, NOW)).toBeNull();
  });
});
