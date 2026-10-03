import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { WebRTCModule } from '../../webrtc/webrtc.module';
import { WorkSessionController } from './work-session.controller';
import { WorkSessionService } from './work-session.service';

@Module({
  imports: [PrismaModule, WebRTCModule],
  controllers: [WorkSessionController],
  providers: [WorkSessionService],
  exports: [WorkSessionService],
})
export class WorkSessionModule {}
