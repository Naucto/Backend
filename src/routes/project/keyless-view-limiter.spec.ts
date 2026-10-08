import {
  KEYLESS_VIEWS_PER_ADDRESS,
  KEYLESS_VIEWS_PER_RELEASE,
  KeylessViewLimiter,
} from './keyless-view-limiter';

describe('KeylessViewLimiter', () => {
  const T0 = 1_000_000;

  it('admits a class worth of views of one game from one address, then no more', () => {
    const limiter = new KeylessViewLimiter();

    for (let i = 0; i < KEYLESS_VIEWS_PER_RELEASE; i++) {
      expect(limiter.admit('a', 1, T0)).toBe(true);
    }
    expect(limiter.admit('a', 1, T0)).toBe(false);
    expect(limiter.admit('a', 2, T0)).toBe(true);
    expect(limiter.admit('b', 1, T0)).toBe(true);
  });

  it('caps one address across every game', () => {
    const limiter = new KeylessViewLimiter();

    for (let i = 0; i < KEYLESS_VIEWS_PER_ADDRESS; i++) {
      expect(limiter.admit('a', i, T0)).toBe(true);
    }
    expect(limiter.admit('a', 99_999, T0)).toBe(false);
  });

  it('admits again once the ten-minute window has passed', () => {
    const limiter = new KeylessViewLimiter();
    for (let i = 0; i < KEYLESS_VIEWS_PER_RELEASE; i++) {
      limiter.admit('a', 1, T0);
    }

    expect(limiter.admit('a', 1, T0 + 9 * 60_000)).toBe(false);
    expect(limiter.admit('a', 1, T0 + 10 * 60_000)).toBe(true);
  });

  it('spends neither budget on a refused view', () => {
    const limiter = new KeylessViewLimiter();
    for (let i = 0; i < KEYLESS_VIEWS_PER_RELEASE; i++) {
      limiter.admit('a', 1, T0);
    }
    for (let i = 0; i < 1_000; i++) {
      limiter.admit('a', 1, T0);
    }

    // Only the 30 admitted views count against the address.
    for (let i = 0; i < KEYLESS_VIEWS_PER_ADDRESS - KEYLESS_VIEWS_PER_RELEASE; i++) {
      expect(limiter.admit('a', 1_000 + i, T0)).toBe(true);
    }
  });
});
