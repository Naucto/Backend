import { WorkSessionController } from "./work-session.controller";
import { WorkSessionService } from "./work-session.service";
import { WebRTCModule } from "@webrtc/webrtc.module";
import { PrismaModule } from "@ourPrisma/prisma.module";

import { Module } from "@nestjs/common";

@Module({
  imports: [PrismaModule, WebRTCModule],
  controllers: [WorkSessionController],
  providers: [WorkSessionService],
  exports: [WorkSessionService]
})
export class WorkSessionModule {}
