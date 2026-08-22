import { Module } from "@nestjs/common";
import { ModerationService } from "./moderation.service";
import { ReportController } from "./report.controller";
import { AnalyticsModule } from "src/analytics/analytics.module";
import { ProjectModule } from "@project/project.module";
import { MultiplayerModule } from "@multiplayer/multiplayer.module";

@Module({
  imports: [AnalyticsModule, ProjectModule, MultiplayerModule],
  controllers: [ReportController],
  providers: [ModerationService],
  exports: [ModerationService]
})
export class ModerationModule {}
