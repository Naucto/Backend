import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WebRTCOfferPeerICEServerConfig } from "./webrtc.dto";
import { getExcerrMessage } from "@util/errors";

const CREDENTIALS_ENDPOINT =
  "https://rtc.live.cloudflare.com/v1/turn/keys/{id}/credentials/generate-ice-servers";

/**
 * The provider's answer, read loosely at both levels: the singular forms are not what its
 * documentation shows, but nothing here controls that response, and accepting them costs a union.
 */
interface MintedICEServer {
  urls: string[] | string;
  username?: string;
  credential?: string;
}

interface MintedICEServers {
  iceServers: MintedICEServer[] | MintedICEServer;
}

/**
 * TURN credentials, held between refreshes.
 *
 * The relay provider issues no standing username and password: a pair is asked for, with a
 * lifetime, and derived from the account key. That is a network call, and an offer is built on the
 * hot path of every join and every ticket refresh -- so it is made on a schedule instead, and the
 * offer reads what it finds.
 *
 * Two consequences are deliberate. One pair is shared by every session, against the provider's own
 * advice of one short-lived pair per user: it cannot be revoked for a single player, and in
 * exchange a provider that is slow or down cannot fail a connection that would have worked. And
 * missing configuration disables this rather than breaking boot, so a deployment without the pair
 * keeps working on whatever relays it has configured.
 */
@Injectable()
export class TurnCredentialsService implements OnModuleInit {
  /** Long enough that no game session can outlive the credentials it was handed. */
  private static readonly TTL_SECONDS = 24 * 60 * 60;
  /**
   * A session picks its relay once, at the offer, and keeps it for as long as it runs. So a pair
   * this close to lapsing is treated as gone: handing it out would cut the game rather than the
   * connection attempt.
   */
  private static readonly MIN_REMAINING_MS = 60 * 60 * 1000;
  private static readonly REQUEST_TIMEOUT_MS = 5000;

  private readonly _logger = new Logger(TurnCredentialsService.name);

  private readonly _keyId: string | undefined;
  private readonly _apiToken: string | undefined;

  private _servers?: WebRTCOfferPeerICEServerConfig[];
  private _expiresAt = 0;

  constructor(configService: ConfigService) {
    this._keyId = configService.get<string>("BACKEND_WEBRTC_TURN_KEY_ID");
    this._apiToken = configService.get<string>("BACKEND_WEBRTC_TURN_API_TOKEN");

    if (!this.isConfigured) {
      this._logger.warn(
        "Minted TURN credentials disabled: BACKEND_WEBRTC_TURN_KEY_ID and " +
        "BACKEND_WEBRTC_TURN_API_TOKEN are not both set -- falling back to config/webrtc.json"
      );
    }
  }

  public get isConfigured(): boolean {
    return Boolean(this._keyId && this._apiToken);
  }

  async onModuleInit(): Promise<void> {
    if (!this.isConfigured) return;

    await this.refresh();
  }

  /** Well inside the lifetime, so several attempts can fail before the pair in hand is at risk. */
  @Cron(CronExpression.EVERY_6_HOURS)
  public async refresh(): Promise<void> {
    if (!this.isConfigured) return;

    const url = CREDENTIALS_ENDPOINT.replace("{id}", String(this._keyId));
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${String(this._apiToken)}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ttl: TurnCredentialsService.TTL_SECONDS }),
        signal: AbortSignal.timeout(TurnCredentialsService.REQUEST_TIMEOUT_MS)
      });
    } catch (err) {
      // Never fatal: the offer has relays to fall back on, and boot awaits this call.
      this._logger.error(`TURN credentials endpoint unreachable: ${getExcerrMessage(err)}`);
      return;
    }

    if (!response.ok) {
      this._logger.error(`TURN credentials refused with HTTP ${response.status}`);
      return;
    }

    let minted: MintedICEServers;

    try {
      minted = (await response.json()) as MintedICEServers;
    } catch (err) {
      this._logger.error(`Malformed TURN credentials response: ${getExcerrMessage(err)}`);
      return;
    }

    const entries = Array.isArray(minted.iceServers) ? minted.iceServers : [ minted.iceServers ];
    const servers = entries.filter(entry => entry?.urls !== undefined).map(entry => {
      const server: WebRTCOfferPeerICEServerConfig = {
        urls: Array.isArray(entry.urls) ? entry.urls : [ entry.urls ],
        username: entry.username,
        credential: entry.credential
      };

      return server;
    });

    if (servers.length === 0) {
      this._logger.error("TURN credentials response carried no ICE server");
      return;
    }

    this._servers = servers;
    this._expiresAt = Date.now() + TurnCredentialsService.TTL_SECONDS * 1000;
    this._logger.log(`Minted TURN credentials for ${servers.length} ICE server(s)`);
  }

  /** Nothing at all, rather than a stale pair: that absence is the caller's cue to fall back. */
  public current(): WebRTCOfferPeerICEServerConfig[] | undefined {
    if (this._expiresAt - Date.now() < TurnCredentialsService.MIN_REMAINING_MS) return undefined;

    return this._servers;
  }
}
