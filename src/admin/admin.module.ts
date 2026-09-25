import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "@auth/auth.module";
import { UserModule } from "@user/user.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ModerationModule } from "@moderation/moderation.module";
import { AnalyticsModule } from "@analytics/analytics.module";
import { AdminInsightsController } from "./admin-insights.controller";
import { AdminInsightsService } from "./admin-insights.service";
import { AdminUserController } from "./admin-user.controller";
import { AdminUserService } from "./admin-user.service";
import { AdminReportController } from "./admin-report.controller";
import { AdminReportService } from "./admin-report.service";
import { AdminModerationLogController } from "./admin-moderation-log.controller";
import { AdminRoleController } from "./admin-role.controller";
import { AdminRoleService } from "./admin-role.service";
import { TargetLinkService } from "./services/target-link.service";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    UserModule,
    ModerationModule,
    AnalyticsModule
  ],
  controllers: [
    AdminInsightsController,
    AdminUserController,
    AdminReportController,
    AdminModerationLogController,
    AdminRoleController
  ],
  providers: [
    AdminInsightsService,
    AdminUserService,
    AdminReportService,
    AdminRoleService,
    TargetLinkService
  ]
})
export class AdminModule {}
