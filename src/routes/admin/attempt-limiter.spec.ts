import { AttemptLimiter } from './attempt-limiter';

describe('AttemptLimiter', () => {
  it('locks a key after its failures, until the window that started with the first one ends', () => {
    let now = 0;
    const limiter = new AttemptLimiter(2, 60_000, () => now);

    limiter.fail('key');
    limiter.assertAllowed('key');
    now = 30_000;
    limiter.fail('key');
    expect(() => {
      limiter.assertAllowed('key');
    }).toThrow('Try again in 1 minute');

    now = 60_000;
    limiter.assertAllowed('key');
  });

  it('keeps keys apart, and forgets one that is cleared', () => {
    const limiter = new AttemptLimiter(1, 60_000);

    limiter.fail('a-key');
    limiter.assertAllowed('another-key');
    limiter.clear('a-key');
    limiter.assertAllowed('a-key');
  });
});
