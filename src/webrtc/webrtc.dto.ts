import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested
} from "class-validator";

export class WebRTCOfferPeerICEServerConfig {
  /**
   * Every transport one relay answers on, which is the shape RTCIceServer takes on the other side.
   * Split into an entry each, they would be several servers, and the browser would gather
   * candidates for every one of them.
   *
   * Unvalidated where its siblings are not, deliberately: validator.js knows http, https and ftp,
   * so an `@IsUrl()` here would reject every STUN and TURN URI the day response validation is
   * wired -- and until then it would not run at all.
   */
  @ApiProperty({ type: [String] })
    urls!: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
    username?: string | undefined;

  @ApiPropertyOptional()
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
