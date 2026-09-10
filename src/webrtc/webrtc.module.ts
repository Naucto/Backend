import { Module } from "@nestjs/common";
import { WebRTCService } from "./webrtc.service";
import { TurnCredentialsService } from "./turn-credentials.service";
import { AppConfig } from "src/app.config";

@Module({
  // TurnCredentialsService is not exported: WebRTCService is its only reader, and an offer is
  // the only place those credentials belong.
  providers: [WebRTCService, TurnCredentialsService, AppConfig],
  exports: [WebRTCService]
})
export class WebRTCModule {}
