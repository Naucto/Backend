import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Deletes the view keys derived from a reader's address, which views stopped writing once they
 * were tied to consent. The counters live on the project and do not move; idempotent.
 */
@Injectable()
export class ReleaseViewKeysRepair {
  private readonly logger = new Logger(ReleaseViewKeysRepair.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<number> {
    const { count } = await this.prisma.releaseView.deleteMany({
      where: { viewerKey: { startsWith: 'ip:' } },
    });
    this.logger.log(`Deleted ${count} address-derived release view key(s)`);
    return count;
  }
}
