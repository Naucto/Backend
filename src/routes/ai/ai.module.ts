import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "@auth/auth.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { AiController, AiKeysController, AiMcpController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiBarrierService } from "./ai-barrier.service";
import { AiJobsService } from "./ai-jobs.service";

@Module({
  imports: [AuthModule, PrismaModule, ConfigModule],
  controllers: [AiController, AiKeysController, AiMcpController],
  providers: [AiService, AiBarrierService, AiJobsService]
})
export class AiModule {}
