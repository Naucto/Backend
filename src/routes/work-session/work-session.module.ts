import { Module } from "@nestjs/common";
import { WorkSessionController } from "./work-session.controller";
import { WorkSessionService } from "./work-session.service";
import { PrismaModule } from "@prisma_naucto/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [WorkSessionController],
  providers: [WorkSessionService],
  exports: [WorkSessionService],
})
export class WorkSessionModule {}
