import { Logger } from '@nestjs/common';
import maxmind from 'maxmind';

import { withEnv } from '../../../test/env';
import { GeoIpService } from './geo-ip.service';

jest.mock('maxmind', () => ({
  __esModule: true,
  default: { open: jest.fn(), validate: jest.fn() },
}));

describe('GeoIpService', () => {
  const open = jest.mocked(maxmind.open);
  const validate = jest.mocked(maxmind.validate);
  const lookup = jest.fn();
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    validate.mockReturnValue(true);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const started = async (path: string | undefined): Promise<GeoIpService> => {
    withEnv({ GEOIP_DB_PATH: path });
    const service = new GeoIpService();
    await service.onModuleInit();
    return service;
  };

  it('knows no country when no database is configured, and opens nothing', async () => {
    const service = await started(undefined);

    expect(open).not.toHaveBeenCalled();
    expect(service.countryOf('81.2.69.142')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once and knows no country when the database cannot be opened', async () => {
    open.mockRejectedValue(new Error('ENOENT'));

    const service = await started('/data/missing.mmdb');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(service.countryOf('81.2.69.142')).toBeNull();
  });

  it('reads the country code of an address', async () => {
    lookup.mockReturnValue({ country: { iso_code: 'GB' } });
    open.mockResolvedValue({ get: lookup } as never);

    const service = await started('/data/country.mmdb');

    expect(service.countryOf('81.2.69.142')).toBe('GB');
    expect(lookup).toHaveBeenCalledWith('81.2.69.142');
  });

  it.each([
    ['an address the database does not hold', null],
    ['an answer without a country', {}],
    ['a malformed code', { country: { iso_code: 'gbr' } }],
  ])('knows no country for %s', async (_case, answer) => {
    lookup.mockReturnValue(answer);
    open.mockResolvedValue({ get: lookup } as never);

    const service = await started('/data/country.mmdb');

    expect(service.countryOf('81.2.69.142')).toBeNull();
  });

  it('never looks up something that is not an address', async () => {
    validate.mockReturnValue(false);
    open.mockResolvedValue({ get: lookup } as never);

    const service = await started('/data/country.mmdb');

    expect(service.countryOf('not-an-ip')).toBeNull();
    expect(service.countryOf(undefined)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});
