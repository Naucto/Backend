import { Module } from "@nestjs/common";
import { WebRTCService } from "./webrtc.service";
import { TurnCredentialsService } from "./turn-credentials.service";
import { AppConfig } from "src/app.config";

@Module({
  providers: [WebRTCService, TurnCredentialsService, AppConfig],
  exports: [WebRTCService]
})
export class WebRTCModule {}
