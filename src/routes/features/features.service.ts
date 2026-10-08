import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

import { FeaturesResponseDto } from './dto/features.dto';

/**
 * A feature flag is a field of {@link FeaturesResponseDto}, which is also what the API serves.
 * It is read below from `config/features.json`, and only a literal `true` turns it on: a deployment
 * whose file predates the flag, or that has no file, keeps it off.
 */
@Injectable()
export class FeaturesService implements OnModuleInit {
  private readonly logger = new Logger(FeaturesService.name);
  private _features: FeaturesResponseDto = { monetization: false };

  get features(): FeaturesResponseDto {
    return this._features;
  }

  async onModuleInit(): Promise<void> {
    const configPath = path.resolve(process.cwd(), 'config', 'features.json');

    try {
      const raw: unknown = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      const flags = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

      // A config written before a flag existed must not be read as turning that flag on.
      this._features = { monetization: flags['monetization'] === true };
      this.logger.log(`Features loaded from ${configPath}: ${JSON.stringify(this._features)}`);
    } catch {
      this.logger.warn(`No readable ${configPath}; every feature stays off`);
    }
  }
}
