import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WebRTCOfferPeerICEServerConfig } from "./webrtc.dto";
import { getExcerrMessage } from "@util/errors";

const CREDENTIALS_ENDPOINT =
  "https://rtc.live.cloudflare.com/v1/turn/keys/{id}/credentials/generate-ice-servers";

/**
 * One entry of the provider's answer. `urls` is a list because a single relay is reachable over
 * several transports (UDP, TCP, TLS) at once -- they are one server, not three.
 */
interface MintedICEServer {
  urls: string[] | string;
  username?: string;
  credential?: string;
}

/** `iceServers` comes back as a list, but a lone object is also documented; both are read. */
interface MintedICEServers {
  iceServers: MintedICEServer[] | MintedICEServer;
}

/**
 * TURN credentials minted on demand, held until they are close to expiring.
 *
 * The relay provider issues no standing username and password: a caller asks for a pair with a
 * lifetime and gets one derived from the account key. That is a network call, and an offer is
 * built on the hot path of every join and every ticket refresh -- so nothing here is asked for at
 * offer time. A pair is minted at start-up and re-minted well before it lapses, and `current()` is
 * a field read.
 *
 * The trade against the provider's own advice (short-lived credentials, one set per user) is
 * deliberate: a shared pair cannot be revoked for one player alone, and in exchange a relay that
 * is slow or down cannot fail a connection that would have worked.
 *
 * Missing configuration disables the service rather than breaking boot, the way an unconfigured
 * OAuth provider does -- `WebRTCService` then falls back to the relays in `config/webrtc.json`.
 */
@Injectable()
export class TurnCredentialsService implements OnModuleInit {
  /**
   * Long enough that no game session outlives its credentials, and re-minted four times inside
   * that window, so a run of failed refreshes has to last most of a day before it is noticed.
   */
  private static readonly TTL_SECONDS = 24 * 60 * 60;
  /**
   * A pair with less than this left is treated as gone. A session picks its relay once, at the
   * offer, and keeps it for as long as it runs; handing out a pair that expires minutes later
   * would cut the game rather than the connection attempt.
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

  /**
   * Re-minted on a schedule rather than on demand so that an offer never waits on the provider.
   * The interval is a quarter of the lifetime: three refreshes may fail in a row and the pair
   * handed out is still valid.
   */
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

  /**
   * The pair in hand, or nothing at all -- which is the caller's cue to use the configured relays.
   * Synchronous by design; see the note on the class.
   */
  public current(): WebRTCOfferPeerICEServerConfig[] | undefined {
    if (this._expiresAt - Date.now() < TurnCredentialsService.MIN_REMAINING_MS) return undefined;

    return this._servers;
  }
}
