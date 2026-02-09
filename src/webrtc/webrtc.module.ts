import { Module } from "@nestjs/common";
import { WebRTCService } from "./webrtc.service";

@Module({
  providers: [WebRTCService],
  exports: [WebRTCService]
})
export class WebRTCModule {}
