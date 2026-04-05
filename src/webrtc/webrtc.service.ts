import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { WebRTCOfferDto, WebRTCOfferPeerICEServerConfig } from "./webrtc.dto";
import { IsArray, IsInt, IsOptional, IsString, IsUrl, validateSync } from "class-validator";
import { plainToInstance } from "class-transformer";
import { WebRTCServiceOfferError } from "./webrtc.error";
import { WebRTCServer } from "@webrtc/server/webrtc.server";
import { WebRTCServerRuntimeError } from "@webrtc/server/webrtc.server.error";

import path from "path";
import fs from "fs/promises";

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
export class WebRTCService implements OnModuleInit {
  private readonly _logger = new Logger(WebRTCService.name);

  private readonly _hookedServers = new Set<WebRTCServer>();

  private _config?: WebRTCServiceConfig;
  private _publicAddress?: string;

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.fetchPublicAddress(),
      this.loadConfig(),
    ]);
  }

  public registerServer(server: WebRTCServer): void {
    this._hookedServers.add(server);
  }

  public shutdownAllServers(): void {
    this._logger.log(`Shutting down ${this._hookedServers.size} WebRTC servers`);
    this._hookedServers.forEach(server => server.shutdown());
  }

  private async fetchPublicAddress(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
      const data = await res.json() as IpifyResponse;
      this._publicAddress = data.ip;
    } catch (err) {
      if (err instanceof Error) {
        this._logger.error(`Failed to fetch public IP address for WebRTC service: ${err.message}`);
      }
      this._logger.error(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async loadConfig(): Promise<void> {
    const configPath = path.resolve(process.cwd(), "config", "webrtc.json");

    try {
      const rawFile = await fs.readFile(configPath, "utf-8");
      const parsedRawObject = JSON.parse(rawFile);

      const configInstance = plainToInstance(WebRTCServiceConfig, parsedRawObject);
      const configErrors = validateSync(configInstance, { whitelist: true, forbidNonWhitelisted: true });

      if (configErrors.length > 0) {
        this._logger.error(`Invalid WebRTC service config in ${configPath}`);
        this._logger.error(JSON.stringify(configErrors));
        return;
      }

      this._config = configInstance;
      this._logger.log(`WebRTC service config loaded successfully from ${configPath}`);
    } catch (err) {
      if (err instanceof Error) {
        this._logger.error(`Failed to read WebRTC service config from ${configPath}: ${err.message}`);
      }
      this._logger.error(err);
    }
  }

  // targetServer can be either a concrete WebRTCServer or a URL to that server
  buildOffer(targetServer: WebRTCServer | string): WebRTCOfferDto {
    if (!this._config) {
      this._logger.error("Attempt at creating WebRTC offer without a valid initialization, bailing out.");
      throw new WebRTCServiceOfferError("WebRTC service is not properly initialized");
    }

    const offerDto = new WebRTCOfferDto();

    let signalingUrl: string;

    if (targetServer instanceof WebRTCServer) {
      signalingUrl = `wss://${this._publicAddress}:${targetServer.port}`;
    } else {
      if (!/ws(s)?:\/\//.test(targetServer)) {
        throw new WebRTCServerRuntimeError(
          `Malformed websocket target server URL: ${targetServer}`
        );
      }

      signalingUrl = targetServer;
    }

    offerDto.signaling = [ signalingUrl ];

    offerDto.maxConns = this._config.maxClients;
    offerDto.peerOpts = {
      config: {
        iceServers: this._config.relays.map(
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
