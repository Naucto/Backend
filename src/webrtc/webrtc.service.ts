import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
  validateSync,
} from 'class-validator';
import fs from 'fs/promises';
import path from 'path';

import { getOptionalEnv } from '../config/env';
import { getExcerrMessage } from '../util/errors';
import { WEBRTC_SERVER_NAMES, WebRTCServer, type WebRTCServerName } from './server/webrtc.server';
import { WebRTCServerRuntimeError } from './server/webrtc.server.error';
import { TurnCredentialsService } from './turn-credentials.service';
import { WebRTCOfferDto, WebRTCOfferPeerICEServerConfig } from './webrtc.dto';
import { WebRTCServiceOfferError } from './webrtc.error';

const WEBSOCKET_URL = /^wss?:\/\//;

class WebRTCServiceConfigRelay {
  @Matches(/^(stuns?|turns?):/)
  url!: string;
  @IsString()
  @IsOptional()
  username?: string;
  @IsString()
  @IsOptional()
  credential?: string;
}

class WebRTCServiceConfig {
  @IsInt()
  @Min(1)
  maxClients!: number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WebRTCServiceConfigRelay)
  relays!: WebRTCServiceConfigRelay[];
}

@Injectable()
export class WebRTCService implements OnModuleInit {
  private static DEV_HOSTNAME = 'localhost';
  /**
   * Browsers warn past four ICE servers and gather candidates more slowly with each one,
   * and a relay that is never the one that answers has cost the connection its setup for
   * nothing. Three is a STUN plus two ways round a symmetric NAT.
   */
  private static MAX_ICE_SERVERS = 3;

  private readonly _logger = new Logger(WebRTCService.name);
  private _started = false;

  private readonly _hookedServers = new Set<WebRTCServer>();

  private _config?: WebRTCServiceConfig;
  private _relayCursor = 0;
  private _nextPort?: number;
  private _publicUrlTemplate?: string | undefined;
  private _publicAddress?: string | undefined;

  constructor(
    @Inject(TurnCredentialsService) private readonly _turnCredentials: TurnCredentialsService,
  ) {}

  public get isLocalDevEnv(): boolean {
    return this._publicAddress === WebRTCService.DEV_HOSTNAME;
  }

  async onModuleInit(): Promise<void> {
    this.loadPublicAddress(getOptionalEnv('BACKEND_WEBRTC_HOSTNAME'));
    this.loadPublicUrlTemplate(getOptionalEnv('BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE'));

    await this.loadConfig();

    for (const server of this._hookedServers) {
      server.listen();
    }
    this._started = true;
  }

  public registerServer(server: WebRTCServer): void {
    this._hookedServers.add(server);
    // Registered after start-up (a server built lazily): bind it straight away.
    if (this._started) {
      server.listen();
    }
  }

  private portBase(): number {
    return getOptionalEnv('BACKEND_WEBRTC_PORT_BASE', 10000);
  }

  /**
   * The port a named server binds, fixed by its name and not by construction order: a deployment
   * maps each name's domain onto one port, outside this repository.
   */
  public allocatePort(name?: WebRTCServerName): number {
    const names = Object.values(WEBRTC_SERVER_NAMES);

    if (name !== undefined) {
      return this.portBase() + names.indexOf(name);
    }

    // Ad-hoc servers have no name and so no domain; they take what is left above the named block.
    this._nextPort ??= this.portBase() + names.length;

    return this._nextPort++;
  }

  public shutdownAllServers(): void {
    this._logger.log(`Shutting down ${this._hookedServers.size} WebRTC servers`);
    this._hookedServers.forEach((server) => server.shutdown());
  }

  /** The host a client reaches a server at when no public URL template is set. */
  public loadPublicAddress(hostname: string | undefined): void {
    if (hostname !== undefined) {
      this._publicAddress = hostname;
      this._logger.log('Public address overriden by environment variable: ' + hostname);
      return;
    }

    this._publicAddress = WebRTCService.DEV_HOSTNAME;

    this._logger.warn(
      `No public address set, falling back to ${this._publicAddress} -- ` +
        'this CANNOT work for production',
    );
  }

  /**
   * Takes a relay inventory, whatever read it. Public because the file is not in the repository --
   * it holds credentials -- so a test has to hand its own inventory over instead.
   */
  public applyConfig(raw: unknown, source: string): boolean {
    const configInstance = plainToInstance(WebRTCServiceConfig, raw);
    const configErrors = validateSync(configInstance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (configErrors.length > 0) {
      this._logger.error(`Invalid WebRTC service config in ${source}`);
      this._logger.error(JSON.stringify(configErrors));
      return false;
    }

    this._config = configInstance;
    this._logger.log(`WebRTC service config loaded successfully from ${source}`);

    return true;
  }

  private async loadConfig(): Promise<void> {
    const configPath = path.resolve(process.cwd(), 'config', 'webrtc.json');

    try {
      const rawFile = await fs.readFile(configPath, 'utf-8');

      this.applyConfig(JSON.parse(rawFile), configPath);
    } catch (err) {
      this._logger.error(
        `Failed to read WebRTC service config from ${configPath}: ${getExcerrMessage(err, String(err))}`,
      );
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

    if (!WEBSOCKET_URL.test(trimmed)) {
      throw new WebRTCServerRuntimeError(
        'BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE must start with ws:// or wss://, ' + `got: ${trimmed}`,
      );
    }

    if (!trimmed.includes('{name}') && !trimmed.includes('{port}')) {
      this._logger.warn(
        'BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE contains neither {name} nor {port}: ' +
          'every WebSocket server will be advertised at the same URL',
      );
    }

    this._publicUrlTemplate = trimmed;
    this._logger.log(`WebSocket public URL template: ${trimmed}`);
  }

  public buildSignalingUrl(targetServer: Pick<WebRTCServer, 'name' | 'port'> | string): string {
    if (typeof targetServer !== 'string') {
      if (this._publicUrlTemplate !== undefined) {
        if (targetServer.name === undefined) {
          throw new WebRTCServerRuntimeError(
            'Cannot build a public URL for a WebSocket server without a name ' +
              `(port ${targetServer.port}); see WEBRTC_SERVER_NAMES`,
          );
        }

        return this._publicUrlTemplate
          .replace(/\{name\}/g, targetServer.name)
          .replace(/\{port\}/g, String(targetServer.port));
      }

      const protocol = this.isLocalDevEnv ? 'ws' : 'wss';
      return `${protocol}://${this._publicAddress}:${targetServer.port}`;
    }

    if (!WEBSOCKET_URL.test(targetServer)) {
      throw new WebRTCServerRuntimeError(`Malformed websocket target server URL: ${targetServer}`);
    }

    return targetServer;
  }

  /**
   * Which relays this offer carries, out of everything the file lists.
   *
   * The file stays the full inventory; an offer is a choice from it. STUN goes first because it is
   * the cheap path and costs a session nothing when the direct connection works, and the TURN
   * entries rotate from one offer to the next so the same relay does not carry every session.
   */
  private pickRelays(relays: readonly WebRTCServiceConfigRelay[]): WebRTCServiceConfigRelay[] {
    const stun = relays.filter((relay) => !relay.username);
    const turn = relays.filter((relay) => relay.username);
    const start = turn.length ? this._relayCursor++ % turn.length : 0;

    return [...stun, ...turn.slice(start), ...turn.slice(0, start)].slice(
      0,
      WebRTCService.MAX_ICE_SERVERS,
    );
  }

  public buildOffer(targetServer: WebRTCServer | string): WebRTCOfferDto {
    if (!this._config) {
      this._logger.error(
        'Attempt at creating WebRTC offer without a valid initialization, bailing out.',
      );
      throw new WebRTCServiceOfferError('WebRTC service is not properly initialized');
    }

    const offerDto = new WebRTCOfferDto();

    const signalingUrl = this.buildSignalingUrl(targetServer);

    offerDto.signaling = [signalingUrl];

    offerDto.maxConns = this._config.maxClients;
    // Minted credentials are one relay reached several ways, not an inventory to choose from, so
    // they go out whole.
    const iceServers =
      this._turnCredentials.current() ??
      this.pickRelays(this._config.relays).map((relay) => {
        const relayConfig: WebRTCOfferPeerICEServerConfig = {
          urls: [relay.url],
          username: relay.username,
          credential: relay.credential,
        };

        return relayConfig;
      });

    offerDto.peerOpts = { config: { iceServers } };

    return offerDto;
  }
}
