import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import { FeaturesResponseDto } from "./dto/features.dto";

/**
 * What a deployment is showing, read once from config/features.json.
 *
 * Every flag is off unless the file says otherwise, so a deployment that ships no file — or ships
 * one that has never heard of a flag added since — shows nothing new rather than something half
 * built. The file in the repository is the one development runs with, and turning a flag on there
 * is what keeps the code around it exercised instead of quietly rotting behind a false.
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
