import { Test, TestingModule } from '@nestjs/testing';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../routes/s3/s3.service';
import { PublishStateRepair } from './publish-state.repair';

describe('PublishStateRepair', () => {
  let repair: PublishStateRepair;

  const prismaMock = {
    project: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const s3Mock = {
    fileExists: jest.fn(),
    deleteFile: jest.fn(),
  };
  /** The rows on the hub, then the rows moderation withholds, as `run` asks for them. */
  const rows = (onHub: { id: string }[], withheld: { id: string }[] = []): void => {
    prismaMock.project.findMany.mockResolvedValueOnce(onHub).mockResolvedValueOnce(withheld);
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishStateRepair,
        { provide: PrismaService, useValue: prismaMock },
        { provide: S3Service, useValue: s3Mock },
      ],
    }).compile();

    repair = module.get(PublishStateRepair);
  });

  it('resets a row whose release blob is gone, and leaves a whole one alone', async () => {
    rows([{ id: uuidOf(2) }, { id: uuidOf(39) }]);
    s3Mock.fileExists.mockImplementation((key: string) =>
      Promise.resolve(key === `release/${uuidOf(2)}`),
    );
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 });

    await expect(repair.run()).resolves.toEqual([uuidOf(39)]);

    expect(prismaMock.project.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [uuidOf(39)] } },
      data: { publishedAt: null, status: 'IN_PROGRESS' },
    });
  });

  it('finds nothing to do on a second run', async () => {
    rows([{ id: uuidOf(2) }]);
    s3Mock.fileExists.mockResolvedValue(true);

    await expect(repair.run()).resolves.toEqual([]);

    expect(prismaMock.project.updateMany).not.toHaveBeenCalled();
  });

  // Its release is out of public reach on purpose: reading that as a lost blob would unpublish it.
  it('never counts a withheld game among the rows that lost their release', async () => {
    rows([], [{ id: uuidOf(7) }]);
    s3Mock.fileExists.mockResolvedValue(false);

    await expect(repair.run()).resolves.toEqual([]);

    expect(prismaMock.project.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { publishedAt: { not: null }, hiddenAt: null } }),
    );
    expect(prismaMock.project.updateMany).not.toHaveBeenCalled();
  });

  it('removes what is still served of a withheld game', async () => {
    rows([], [{ id: uuidOf(7) }]);
    s3Mock.fileExists.mockImplementation((key: string) =>
      Promise.resolve(key === `release/${uuidOf(7)}`),
    );
    jest.spyOn(repair['logger'], 'warn').mockImplementation();

    await repair.run();

    expect(s3Mock.deleteFile.mock.calls).toEqual([[{ key: `release/${uuidOf(7)}` }]]);
  });

  it('asks about the release, the cover and the clip of a withheld game', async () => {
    rows([], [{ id: uuidOf(7) }]);
    s3Mock.fileExists.mockResolvedValue(false);

    await repair.run();

    expect(s3Mock.fileExists.mock.calls).toEqual([
      [`release/${uuidOf(7)}`],
      [`projects/${uuidOf(7)}/image`],
      [`projects/${uuidOf(7)}/clip`],
    ]);
  });
});
