import {
  crashFingerprint,
  normalizeFrame,
  normalizeMessage,
  stackFrames,
} from './crash-fingerprint';

const V8_STACK = `TypeError: Cannot read properties of undefined (reading 'x')
    at Player.update (https://naucto.net/chunk-AB12CD34.js:1:2345)
    at Engine.tick (https://naucto.net/main-ZZ99YY88.js:3:44)
    at loop (https://naucto.net/main-ZZ99YY88.js:3:900)
    at frame (https://naucto.net/main-ZZ99YY88.js:4:1)`;

const GECKO_STACK = `update@https://naucto.net/chunk-AB12CD34.js:1:2345
tick@https://naucto.net/main-ZZ99YY88.js:3:44`;

describe('crash fingerprints', () => {
  it('takes ids, numbers and addresses out of a message', () => {
    expect(normalizeMessage('Release 42 failed at https://x.test/a?b=1 for 9f86d081884c7d65')).toBe(
      'Release <n> failed at <url> for <id>',
    );
  });

  it('drops the origin, chunk hash and position of a frame', () => {
    expect(
      normalizeFrame('    at Player.update (https://naucto.net/chunk-AB12CD34.js:1:2345)'),
    ).toBe('Player.update (/chunk.js)');
    expect(normalizeFrame('update@https://naucto.net/chunk-AB12CD34.js:1:2345')).toBe(
      'update@/chunk.js',
    );
  });

  it('reads the frames of V8 and Gecko stacks', () => {
    expect(stackFrames(V8_STACK)).toHaveLength(4);
    expect(stackFrames(GECKO_STACK)).toHaveLength(2);
  });

  it('gives one crash the same fingerprint across deploys and ids', () => {
    const redeployed = V8_STACK.replace(/AB12CD34/g, 'QQ77RR66').replace(/:1:2345/, ':1:9999');
    expect(crashFingerprint('WEB', 'TypeError', 'Release 1 broke', V8_STACK)).toBe(
      crashFingerprint('WEB', 'TypeError', 'Release 2 broke', redeployed),
    );
  });

  it('tells crashes of different sources, names or frames apart', () => {
    const base = crashFingerprint('WEB', 'TypeError', 'boom', V8_STACK);
    expect(crashFingerprint('ENGINE', 'TypeError', 'boom', V8_STACK)).not.toBe(base);
    expect(crashFingerprint('WEB', 'RangeError', 'boom', V8_STACK)).not.toBe(base);
    expect(crashFingerprint('WEB', 'TypeError', 'boom', GECKO_STACK)).not.toBe(base);
  });
});
