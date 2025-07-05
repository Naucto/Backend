import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {PrismaService} from "src/prisma/prisma.service";

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async cleanTimedOutWorkSessions() {
    await this.prisma.workSession.deleteMany({
      where: {
        lastSave: {
          lt: new Date(Date.now() - 10 * 60 * 1000)
        }
      }
    });
  }
}
