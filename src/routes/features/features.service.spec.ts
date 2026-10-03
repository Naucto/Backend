import { promises as fs } from 'fs';

import { FeaturesService } from './features.service';

describe('FeaturesService', () => {
  let service: FeaturesService;
  let readFile: jest.SpyInstance;

  beforeEach(() => {
    service = new FeaturesService();
    readFile = jest.spyOn(fs, 'readFile');
    jest.spyOn(service['logger'], 'log').mockImplementation();
    jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps every feature off until the config is read', () => {
    expect(service.features).toEqual({ monetization: false });
  });

  it('turns on a flag the config sets to true', async () => {
    readFile.mockResolvedValue('{"monetization": true}');

    await service.onModuleInit();

    expect(service.features).toEqual({ monetization: true });
  });

  it.each([
    ['no such flag', '{}'],
    ['a truthy value that is not true', '{"monetization": "true"}'],
    ['an array', '[true]'],
    ['null', 'null'],
    ['malformed JSON', '{monetization'],
  ])('keeps a flag off when the config holds %s', async (_case, content) => {
    readFile.mockResolvedValue(content);

    await service.onModuleInit();

    expect(service.features).toEqual({ monetization: false });
  });

  it('keeps every feature off when the config cannot be read', async () => {
    readFile.mockRejectedValue(Object.assign(new Error('no such file'), { code: 'ENOENT' }));

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(service.features).toEqual({ monetization: false });
  });
});
