import { Module } from "@nestjs/common";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ProjectCommentController } from "./project-comment.controller";
import { ProjectCommentService } from "./project-comment.service";
import { AnalyticsModule } from "src/analytics/analytics.module";

@Module({
  imports: [PrismaModule, AnalyticsModule],
  controllers: [ProjectCommentController],
  providers: [ProjectCommentService],
  exports: [ProjectCommentService]
})
export class ProjectCommentModule {}
