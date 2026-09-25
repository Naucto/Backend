import { DownloadModule } from "@common/download/download.module";
import { Module } from "@nestjs/common";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { S3Module } from "@s3/s3.module";
import { AnalyticsModule } from "@analytics/analytics.module";
import { PermissionsGuard } from "@auth/guards/permissions.guard";

@Module({
  imports: [DownloadModule, PrismaModule, S3Module, AnalyticsModule],
  controllers: [ProjectController],
  // PermissionsGuard is declared here rather than pulled in with AuthModule: importing
  // AuthModule would drag in UserModule, which imports this module back.
  providers: [ProjectService, PermissionsGuard],
  exports: [ProjectService]
})
export class ProjectModule {}
