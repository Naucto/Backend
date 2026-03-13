import { Module } from "@nestjs/common";
import { WebRTCService } from "./webrtc.service";
import { AppConfig } from "src/app.config";

@Module({
  providers: [WebRTCService, AppConfig],
  exports: [WebRTCService]
})
export class WebRTCModule {}
