import { Module } from "@nestjs/common";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { S3Module } from "@s3/s3.module";
import { AnalyticsModule } from "src/analytics/analytics.module";

@Module({
  imports: [PrismaModule, S3Module, AnalyticsModule],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService]
})
export class ProjectModule {}
