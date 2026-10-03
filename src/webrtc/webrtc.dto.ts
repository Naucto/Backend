import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';

export class WebRTCOfferPeerICEServerConfig {
  /**
   * Every transport one relay answers on, the shape RTCIceServer takes: one entry per transport
   * would be several servers, and a browser gathers candidates for each.
   * No `@IsUrl()`: validator.js accepts only http, https and ftp, so it would reject STUN and
   * TURN URIs.
   */
  @ApiProperty({ type: [String] })
  urls!: string[];

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  username?: string | undefined;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  credential?: string | undefined;
}

export class WebRTCOfferPeerOptsConfig {
  @ApiProperty({ type: () => [WebRTCOfferPeerICEServerConfig] })
  @ValidateNested()
  @Type(() => WebRTCOfferPeerICEServerConfig)
  iceServers!: WebRTCOfferPeerICEServerConfig[];
}

export class WebRTCOfferPeerOpts {
  @ApiProperty({ type: () => WebRTCOfferPeerOptsConfig })
  @ValidateNested()
  @Type(() => WebRTCOfferPeerOptsConfig)
  config!: WebRTCOfferPeerOptsConfig;
}

export class WebRTCOfferDto {
  @ApiProperty()
  @IsArray()
  signaling!: Array<string>;

  @ApiProperty()
  @IsInt()
  maxConns!: number;

  @ApiProperty({ type: () => WebRTCOfferPeerOpts })
  @ValidateNested()
  @Type(() => WebRTCOfferPeerOpts)
  peerOpts!: WebRTCOfferPeerOpts;
}
