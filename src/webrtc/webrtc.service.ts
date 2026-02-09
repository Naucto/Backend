import { Injectable } from "@nestjs/common";
import { WebRTCOfferDto } from "@common/dto/webrtc.dto";

@Injectable()
export class WebRTCService {
  constructor() {}

  async createOffer(): Promise<WebRTCOfferDto> {

  }
};
