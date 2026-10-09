import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import maxmind, { CountryResponse, Reader } from 'maxmind';

import { getOptionalEnv } from '../../config/env';

/**
 * Reads the country of an address from an IP-to-country database in MMDB format (DB-IP Lite or
 * GeoLite2), mounted at runtime. The address is only looked up, never stored. Without a database
 * every country is unknown.
 */
@Injectable()
export class GeoIpService implements OnModuleInit {
  private readonly logger = new Logger(GeoIpService.name);
  private reader: Reader<CountryResponse> | null = null;

  async onModuleInit(): Promise<void> {
    const path = getOptionalEnv('GEOIP_DB_PATH');
    if (!path) {
      this.logger.log('GEOIP_DB_PATH is not set; analytics records no country');
      return;
    }
    try {
      this.reader = await maxmind.open<CountryResponse>(path);
      this.logger.log(`Country lookups read ${path}`);
    } catch (error) {
      this.logger.warn(`Cannot open ${path}; analytics records no country: ${String(error)}`);
    }
  }

  /** The ISO 3166-1 alpha-2 code of the address's country, or null when unknown. */
  countryOf(address: string | undefined): string | null {
    if (!this.reader || !address || !maxmind.validate(address)) {
      return null;
    }
    try {
      const code = this.reader.get(address)?.country?.iso_code;
      return code && /^[A-Z]{2}$/.test(code) ? code : null;
    } catch {
      return null;
    }
  }
}
