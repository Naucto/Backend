import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as dotenv from "dotenv";
import { PublishStateRepair } from "./publish-state.repair";
import { RepairModule } from "./repair.module";

dotenv.config();

(async () => {
  const app = await NestFactory.createApplicationContext(RepairModule, {
    logger: ["log", "warn", "error"]
  });
  try {
    await app.get(PublishStateRepair).run();
  } catch (error) {
    new Logger("repair").error(error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
})();
