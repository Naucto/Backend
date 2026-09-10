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
   * Every transport the same relay answers on -- `stun:`, `turn:` over UDP and TCP, `turns:` over
   * TLS. One server, several addresses, which is the shape RTCIceServer takes on the other side:
   * splitting them into one entry each would make the browser gather candidates for each in turn.
   *
   * Deliberately unvalidated. `@IsUrl()` would be dead metadata here -- the global ValidationPipe
   * only ever sees request bodies, and this class is only ever returned -- but the day someone
   * wires response validation it would reject every one of these, validator.js knowing only
   * http/https/ftp.
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
