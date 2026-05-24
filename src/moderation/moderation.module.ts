import { Module } from "@nestjs/common";
import { ModerationService } from "./moderation.service";
import { ReportController } from "./report.controller";

@Module({
  controllers: [ReportController],
  providers: [ModerationService],
  exports: [ModerationService]
})
export class ModerationModule {}
