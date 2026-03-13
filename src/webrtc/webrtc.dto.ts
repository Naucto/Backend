import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUrl, ValidateNested } from "class-validator";

export class WebRTCOfferPeerICEServerConfig {
  @ApiProperty()
  @IsUrl()
    urls!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
    username?: string | undefined;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
    credentials?: string | undefined;
};

export class WebRTCOfferPeerOptsConfig {
  @ApiProperty({ type: () => [WebRTCOfferPeerICEServerConfig] })
  @ValidateNested()
  @Type(() => WebRTCOfferPeerICEServerConfig)
    iceServers!: WebRTCOfferPeerICEServerConfig[];
};

export class WebRTCOfferPeerOpts {
  @ApiProperty({ type: () => WebRTCOfferPeerOptsConfig })
  @ValidateNested()
  @Type(() => WebRTCOfferPeerOptsConfig)
    config!: WebRTCOfferPeerOptsConfig;
};

export class WebRTCOfferDto {
  @ApiProperty()
  @IsUrl()
    signaling!: string;

  @ApiProperty()
  @IsInt()
    maxConns!: number;

  @ApiProperty({ type: () => WebRTCOfferPeerOpts })
  @ValidateNested()
  @Type(() => WebRTCOfferPeerOpts)
    peerOpts!: WebRTCOfferPeerOpts;
};
