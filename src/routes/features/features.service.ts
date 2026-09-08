import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import { FeaturesResponseDto } from "./dto/features.dto";

/**
 * What a deployment is showing.
 *
 * Every flag is off unless the config says otherwise: a deployment whose file is missing, or whose
 * file has never heard of a flag added since, shows nothing new rather than something half built.
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
