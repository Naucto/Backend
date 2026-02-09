import { Injectable, Logger } from "@nestjs/common";
import { WebRTCOfferDto, WebRTCOfferPeerICEServerConfig } from "./webrtc.dto";
import { IsArray, IsInt, IsOptional, IsString, IsUrl, validateSync } from "class-validator";
import { plainToInstance } from "class-transformer";
import { WebRTCServiceOfferError } from "./webrtc.error";
import { AppConfig } from "src/app.config";

import path from "path";
import fs from "fs/promises";
import fetch from "node-fetch";

class WebRTCServiceConfigRelay {
  @IsUrl()
    url!: string;
  @IsString()
  @IsOptional()
    username?: string;
  @IsString()
  @IsOptional()
    credential?: string;
};

class WebRTCServiceConfig {
  @IsInt()
    maxClients!: number;
  @IsArray()
    relays!: WebRTCServiceConfigRelay[];
};

// FIXME: If we need to use this elsewhere, move it to a separate file
type IpifyResponse = {
  ip: string;
};

@Injectable()
export class WebRTCService {
  private readonly logger = new Logger(WebRTCService.name);

  private config?: WebRTCServiceConfig;
  private publicAddress?: string;

  constructor(private readonly appConfig: AppConfig) {
    fetch("https://api.ipify.org?format=json")
      .then(res => res.json() as Promise<IpifyResponse>)
      .then(data => this.publicAddress = data.ip)
      .catch(err => {
        this.logger.error(`Failed to fetch public IP address for WebRTC service: ${err.message}`);
        this.logger.error(err);
      });

    const configPath = path.resolve(process.cwd(), "config", "webrtc.json");

    fs.readFile(configPath, "utf-8")
      .then(rawFile => {
        const parsedRawObject = JSON.parse(rawFile);

        const configInstance = plainToInstance(WebRTCServiceConfig, parsedRawObject);
        const configErrors = validateSync(configInstance, { whitelist: true, forbidNonWhitelisted: true });

        if (configErrors.length > 0) {
          this.logger.error(`Invalid WebRTC service config in ${configPath}`);
          this.logger.error(JSON.stringify(configErrors));

          return;
        }

        this.config = configInstance;
        this.logger.log(`WebRTC service config loaded successfully from ${configPath}`);
      })
      .catch(err => {
        this.logger.error(`Failed to read WebRTC service config from ${configPath}: ${err.message}`);
        this.logger.error(err);
      });
  }

  async createOffer(): Promise<WebRTCOfferDto> {
    if (!this.config) {
      this.logger.error("Attempt at creating WebRTC offer without a valid initialization, bailing out.");
      throw new WebRTCServiceOfferError("WebRTC service is not properly initialized");
    }

    const offerDto = new WebRTCOfferDto();

    offerDto.signaling = `ws://${this.publicAddress}:${this.appConfig.getPort()}`;
    offerDto.maxConns = this.config.maxClients;
    offerDto.peerOpts = {
      config: {
        iceServers: this.config.relays.map(
          relay => {
            const relayConfig: WebRTCOfferPeerICEServerConfig = {
              urls: relay.url,
              username: relay.username,
              credentials: relay.credential
            };

            return relayConfig;
          }
        )
      }
    };

    return offerDto;
  }
};
