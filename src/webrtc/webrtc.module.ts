import { Module } from '@nestjs/common';

import { TurnCredentialsService } from './turn-credentials.service';
import { WebRTCService } from './webrtc.service';

@Module({
  providers: [WebRTCService, TurnCredentialsService],
  exports: [WebRTCService],
})
export class WebRTCModule {}
