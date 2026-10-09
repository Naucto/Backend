import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ReleaseViewKeysRepair } from './release-view-keys.repair';

describe('ReleaseViewKeysRepair', () => {
  it('deletes only the view keys derived from an address', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const prisma = { releaseView: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) } };

    await expect(new ReleaseViewKeysRepair(prisma as unknown as PrismaService).run()).resolves.toBe(
      3,
    );

    expect(prisma.releaseView.deleteMany).toHaveBeenCalledWith({
      where: { viewerKey: { startsWith: 'ip:' } },
    });
  });
});
