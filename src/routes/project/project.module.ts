import { Module } from "@nestjs/common";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { S3Module } from "@s3/s3.module";
import { AnalyticsModule } from "src/analytics/analytics.module";
import { RolesGuard } from "@auth/guards/roles.guard";

@Module({
  imports: [PrismaModule, S3Module, AnalyticsModule],
  controllers: [ProjectController],
  // RolesGuard is declared here rather than pulled in with AuthModule: importing
  // AuthModule would drag in UserModule, which imports this module back.
  providers: [ProjectService, RolesGuard],
  exports: [ProjectService]
})
export class ProjectModule {}
