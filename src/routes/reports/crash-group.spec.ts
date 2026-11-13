import { crashGroupKey, normalizeMessage } from './crash-group';

describe('crash groups', () => {
  it('takes ids, numbers and addresses out of a message', () => {
    expect(normalizeMessage('Release 42 failed at https://x.test/a?b=1 for 9f86d081884c7d65')).toBe(
      'Release <n> failed at <url> for <id>',
    );
  });

  it('gives one crash the same key whatever its ids', () => {
    expect(crashGroupKey('WEB', 'TypeError', 'Release 1 broke')).toBe(
      crashGroupKey('WEB', 'TypeError', 'Release 2  broke'),
    );
    expect(crashGroupKey('WEB', 'TypeError', 'Release 1 broke')).toBe(
      'WEB:TypeError: Release <n> broke',
    );
  });

  it('keeps a browser crash apart from a backend crash that reads the same', () => {
    expect(crashGroupKey('WEB', 'TypeError', 'boom')).not.toBe(
      crashGroupKey('BACKEND', 'TypeError', 'boom'),
    );
  });

  it('tells crashes of different names or messages apart', () => {
    expect(crashGroupKey('WEB', 'TypeError', 'boom')).not.toBe(
      crashGroupKey('WEB', 'RangeError', 'boom'),
    );
    expect(crashGroupKey('WEB', 'TypeError', 'boom')).not.toBe(
      crashGroupKey('WEB', 'TypeError', 'bang'),
    );
  });

  it('stays short enough to index', () => {
    expect(crashGroupKey('WEB', 'Error', 'x'.repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});
