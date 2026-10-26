import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "@auth/auth.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { S3Module } from "@s3/s3.module";
import { AiController, AiKeysController, AiMcpController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiApplyService } from "./ai-apply.service";
import { AiWorkspaceController, AiWorkspaceMcpController } from "./ai-workspace.controller";
import { AiWorkspaceService } from "./ai-workspace.service";
import { AiJobsService } from "./ai-jobs.service";

@Module({
  imports: [AuthModule, PrismaModule, ConfigModule, S3Module],
  controllers: [AiController, AiKeysController, AiMcpController, AiWorkspaceController, AiWorkspaceMcpController],
  providers: [AiService, AiApplyService, AiJobsService, AiWorkspaceService]
})
export class AiModule {}
