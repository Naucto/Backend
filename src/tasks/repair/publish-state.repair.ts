import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Service } from "@s3/s3.service";

/**
 * Rows that claim a release nobody can download.
 *
 * Until `publish` and `unpublish` wrote the row and the blob in the safe order, a project could
 * keep its `publishedAt` after its `release/<id>` object was gone. Idempotent: a repaired row no
 * longer matches the select.
 */
@Injectable()
export class PublishStateRepair {
  private readonly logger = new Logger(PublishStateRepair.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service
  ) {}

  async run(): Promise<number[]> {
    const claimed = await this.prisma.project.findMany({
      where: { publishedAt: { not: null } },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    const repaired: number[] = [];

    for (const { id } of claimed) {
      if (await this.s3.fileExists(`release/${id}`)) continue;
      await this.prisma.project.update({
        where: { id },
        data: { publishedAt: null, status: "IN_PROGRESS" }
      });
      this.logger.warn(
        `Project ${id}: publishedAt set but release/${id} is missing, reset to unpublished`
      );
      repaired.push(id);
    }

    this.logger.log(
      `Checked ${claimed.length} published rows, repaired ${repaired.length}`
    );

    return repaired;
  }
}
