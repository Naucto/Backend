import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUrl, ValidateNested } from "class-validator";

export class WebRTCOfferPeerICEServerConfig {
  @IsUrl()
    urls!: string;
  @IsString()
  @IsOptional()
    username: string | undefined;
  @IsString()
  @IsOptional()
    credentials: string | undefined;
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

export class WebRTCOfferDTO {
  @IsUrl()
    signaling!: string;
  @IsInt()
    maxConns!: number;
  @ValidateNested()
  @Type(() => WebRTCOfferPeerOpts)
    peerOpts!: WebRTCOfferPeerOpts;
};
