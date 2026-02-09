import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUrl, ValidateNested } from "class-validator";

export class WebRTCOfferPeerICEServerConfig {
  @IsUrl()
    urls!: string;
  @IsString()
  @IsOptional()
    username?: string;
  @IsString()
  @IsOptional()
    credentials?: string;
};

export class WebRTCOfferPeerOptsConfig {
  @ValidateNested()
  @Type(() => WebRTCOfferPeerICEServerConfig)
    iceServers!: WebRTCOfferPeerICEServerConfig[];
};

export class WebRTCOfferPeerOpts {
  @ValidateNested()
  @Type(() => WebRTCOfferPeerOptsConfig)
    config!: WebRTCOfferPeerOptsConfig;
};

export class WebRTCOfferDto {
  @IsUrl()
    signaling!: string;
  @IsInt()
    maxConns!: number;
  @ValidateNested()
  @Type(() => WebRTCOfferPeerOpts)
    peerOpts!: WebRTCOfferPeerOpts;
};
