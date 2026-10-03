import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { projectKeys } from '../../routes/project/project-keys';
import { S3Service } from '../../routes/s3/s3.service';

/**
 * Resets rows that claim a release whose object is missing from storage; idempotent, since a
 * repaired row stops matching.
 */
@Injectable()
export class PublishStateRepair {
  private readonly logger = new Logger(PublishStateRepair.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async run(): Promise<number[]> {
    const claimed = await this.prisma.project.findMany({
      where: { publishedAt: { not: null } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const repaired: number[] = [];

    for (const { id } of claimed) {
      const release = projectKeys.release(id);
      if (await this.s3.fileExists(release)) {
        continue;
      }
      this.logger.warn(
        `Project ${id}: publishedAt set but ${release} is missing, resetting to unpublished`,
      );
      repaired.push(id);
    }

    if (repaired.length > 0) {
      await this.prisma.project.updateMany({
        where: { id: { in: repaired } },
        data: { publishedAt: null, status: 'IN_PROGRESS' },
      });
    }

    this.logger.log(`Checked ${claimed.length} published rows, repaired ${repaired.length}`);

    return repaired;
  }
}
