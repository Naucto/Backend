import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ProjectModule } from "@project/project.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { AdminFeaturedReleaseController } from "./admin-featured-release.controller";
import { CurationService } from "./curation.service";
import { FeaturedReleaseController } from "./featured-release.controller";

@Module({
  imports: [AuthModule, PrismaModule, ProjectModule, NotificationsModule],
  controllers: [FeaturedReleaseController, AdminFeaturedReleaseController],
  providers: [CurationService],
  exports: [CurationService]
})
export class CurationModule {}
