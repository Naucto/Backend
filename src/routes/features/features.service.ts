import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import { FeaturesResponseDto } from "./dto/features.dto";

/**
 * Each flag is taken one key at a time and falls back to off, rather than the parsed object being
 * used as the answer: a config written before a flag existed must not be read as turning it on.
 */
@Injectable()
export class FeaturesService implements OnModuleInit {
  private readonly _logger = new Logger(FeaturesService.name);
  private _features: FeaturesResponseDto = { monetization: false };

  get features(): FeaturesResponseDto {
    return this._features;
  }

  async onModuleInit(): Promise<void> {
    const configPath = path.resolve(process.cwd(), "config", "features.json");

    try {
      const raw: unknown = JSON.parse(await fs.readFile(configPath, "utf-8"));
      const flags = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

      this._features = { monetization: flags["monetization"] === true };
      this._logger.log(`Features loaded from ${configPath}: ${JSON.stringify(this._features)}`);
    } catch {
      this._logger.warn(`No readable ${configPath}; every feature stays off`);
    }
  }
}
