import { Module } from "@nestjs/common";
import { WebRTCService } from "./webrtc.service";
import { TurnCredentialsService } from "./turn-credentials.service";

@Module({
  providers: [WebRTCService, TurnCredentialsService],
  exports: [WebRTCService]
})
export class WebRTCModule {}
