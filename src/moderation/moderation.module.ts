import { Module, OnModuleInit } from "@nestjs/common";
import { ModerationService } from "./moderation.service";
import { ReportController } from "./report.controller";
import { AnalyticsModule } from "src/analytics/analytics.module";
import { ProjectModule } from "@project/project.module";
import { ProjectService } from "@project/project.service";
import { MultiplayerModule } from "@multiplayer/multiplayer.module";
import { MultiplayerService } from "@multiplayer/multiplayer.service";

@Module({
  imports: [AnalyticsModule, ProjectModule, MultiplayerModule],
  controllers: [ReportController],
  providers: [ModerationService],
  exports: [ModerationService]
})
export class ModerationModule implements OnModuleInit {
  constructor(
    private readonly projectService: ProjectService,
    private readonly multiplayerService: MultiplayerService
  ) {}

  /**
   * Wires "a project went dark" to "end its live sessions".
   *
   * Done here rather than by injecting MultiplayerService into ProjectService:
   * multiplayer already depends on projects, so the direct edge would be a
   * cycle. This module sits above both and can see them.
   */
  onModuleInit(): void {
    this.projectService.registerVisibilityHook({
      onProjectHidden: (projectId) =>
        this.multiplayerService.endSessionsForProject(projectId)
    });
  }
}
