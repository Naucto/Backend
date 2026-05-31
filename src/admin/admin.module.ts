import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "@auth/auth.module";
import { UserModule } from "@user/user.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ModerationModule } from "src/moderation/moderation.module";
import { AnalyticsModule } from "src/analytics/analytics.module";
import { AdminCsrfMiddleware } from "./middleware/csrf.middleware";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminInsightsController } from "./admin-insights.controller";
import { AdminInsightsService } from "./admin-insights.service";
import { AdminUserController } from "./admin-user.controller";
import { AdminUserService } from "./admin-user.service";
import { AdminProjectController } from "./admin-project.controller";
import { AdminProjectService } from "./admin-project.service";
import { AdminCommentController } from "./admin-comment.controller";
import { AdminCommentService } from "./admin-comment.service";
import { AdminReportController } from "./admin-report.controller";
import { AdminReportService } from "./admin-report.service";
import { AdminModerationLogController } from "./admin-moderation-log.controller";
import { AdminRoleController } from "./admin-role.controller";
import { AdminRoleService } from "./admin-role.service";
import { AdminLookupController } from "./admin-lookup.controller";
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
    AdminAuthController,
    AdminInsightsController,
    AdminUserController,
    AdminProjectController,
    AdminCommentController,
    AdminReportController,
    AdminModerationLogController,
    AdminRoleController,
    AdminLookupController
  ],
  providers: [
    AdminInsightsService,
    AdminUserService,
    AdminProjectService,
    AdminCommentService,
    AdminReportService,
    AdminRoleService,
    TargetLinkService
  ]
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AdminCsrfMiddleware)
      .forRoutes({ path: "admin/*", method: RequestMethod.ALL });
  }
}
