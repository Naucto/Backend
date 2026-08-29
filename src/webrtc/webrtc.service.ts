import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { WebRTCOfferDto, WebRTCOfferPeerICEServerConfig } from "./webrtc.dto";
import { IsArray, IsInt, IsOptional, IsString, IsUrl, validateSync } from "class-validator";
import { plainToInstance } from "class-transformer";
import { WebRTCServiceOfferError } from "./webrtc.error";
import { WebRTCServer } from "@webrtc/server/webrtc.server";
import { WebRTCServerRuntimeError } from "@webrtc/server/webrtc.server.error";

import path from "path";
import fs from "fs/promises";
import { ConfigService } from "@nestjs/config";

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

@Injectable()
export class WebRTCService implements OnModuleInit {
  private static DEV_HOSTNAME = "localhost";

  private readonly _logger = new Logger(WebRTCService.name);

  private readonly _hookedServers = new Set<WebRTCServer>();

  private _config?: WebRTCServiceConfig;
  private _nextPort?: number;
  private _publicUrlTemplate?: string | undefined;
  public _publicAddress?: string | undefined;

  constructor(
    @Inject(ConfigService) private readonly _configService: ConfigService
  )
  {}

  public get isLocalDevEnv(): boolean {
    return this._publicAddress === WebRTCService.DEV_HOSTNAME;
  }

  async onModuleInit(): Promise<void> {
    this._publicAddress = this._configService.get<string>("BACKEND_WEBRTC_HOSTNAME");
    this.loadPublicUrlTemplate(
      this._configService.get<string>("BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE")
    );

    await Promise.all([
      this.fetchPublicAddress(),
      this.loadConfig(),
    ]);
  }

  public registerServer(server: WebRTCServer): void {
    this._hookedServers.add(server);
  }

  public allocatePort(): number {
    if (this._nextPort === undefined) {
      const base = Number(this._configService.get<string>("BACKEND_WEBRTC_PORT_BASE"));
      this._nextPort = Number.isInteger(base) && base > 0 ? base : 10000;
    }

    return this._nextPort++;
  }

  public shutdownAllServers(): void {
    this._logger.log(`Shutting down ${this._hookedServers.size} WebRTC servers`);
    this._hookedServers.forEach(server => server.shutdown());
  }

  private async fetchPublicAddress(): Promise<void> {
    if (this._publicAddress !== undefined) {
      this._logger.log(
        "Public address overriden by environment variable: " +
        this._publicAddress
      );
      return;
    }

    this._publicAddress = WebRTCService.DEV_HOSTNAME;

    this._logger.warn(
      `No public address set, falling back to ${this._publicAddress} -- ` +
      "this CANNOT work for production"
    );
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

  /**
   * Production advertises one subdomain per WebSocket server through
   * BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE (e.g. `wss://{name}.ws.beta.naucto.net`,
   * `{name}` being the server's stable public name, `{port}` its bound port).
   * Without a template the server is reached directly on its port at
   * BACKEND_WEBRTC_HOSTNAME (local dev).
   */
  public loadPublicUrlTemplate(template: string | undefined): void {
    const trimmed = template?.trim();

    if (!trimmed) {
      this._publicUrlTemplate = undefined;
      return;
    }

    if (!/^wss?:\/\//.test(trimmed)) {
      throw new WebRTCServerRuntimeError(
        "BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE must start with ws:// or wss://, " +
        `got: ${trimmed}`
      );
    }

    if (!trimmed.includes("{name}") && !trimmed.includes("{port}")) {
      this._logger.warn(
        "BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE contains neither {name} nor {port}: " +
        "every WebSocket server will be advertised at the same URL"
      );
    }

    this._publicUrlTemplate = trimmed;
    this._logger.log(`WebSocket public URL template: ${trimmed}`);
  }

  public buildSignalingUrl(
    targetServer: Pick<WebRTCServer, "name" | "port"> | string
  ): string {
    if (typeof targetServer !== "string") {
      if (this._publicUrlTemplate !== undefined) {
        if (targetServer.name === undefined) {
          throw new WebRTCServerRuntimeError(
            "Cannot build a public URL for a WebSocket server without a name " +
            `(port ${targetServer.port}); see WEBRTC_SERVER_NAMES`
          );
        }

        return this._publicUrlTemplate
          .replace(/\{name\}/g, targetServer.name)
          .replace(/\{port\}/g, String(targetServer.port));
      }

      const protocol = this.isLocalDevEnv ? "ws" : "wss";
      return `${protocol}://${this._publicAddress}:${targetServer.port}`;
    }

    if (!/ws(s)?:\/\//.test(targetServer)) {
      throw new WebRTCServerRuntimeError(
        `Malformed websocket target server URL: ${targetServer}`
      );
    }

    return targetServer;
  }

  // targetServer can be either a concrete WebRTCServer or a URL to that server
  public buildOffer(targetServer: WebRTCServer | string): WebRTCOfferDto {
    if (!this._config) {
      this._logger.error("Attempt at creating WebRTC offer without a valid initialization, bailing out.");
      throw new WebRTCServiceOfferError("WebRTC service is not properly initialized");
    }

    const offerDto = new WebRTCOfferDto();

    const signalingUrl = this.buildSignalingUrl(targetServer);

    offerDto.signaling = [ signalingUrl ];

    offerDto.maxConns = this._config.maxClients;
    offerDto.peerOpts = {
      config: {
        iceServers: this._config.relays.map(
          relay => {
            const relayConfig: WebRTCOfferPeerICEServerConfig = {
              urls: relay.url,
              username: relay.username,
              credential: relay.credential
            };

            return relayConfig;
          }
        )
      }
    };

    return offerDto;
  }
};
