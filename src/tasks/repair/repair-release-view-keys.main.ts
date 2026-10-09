import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { ReleaseViewKeysRepair } from './release-view-keys.repair';
import { RepairModule } from './repair.module';

(async () => {
  const app = await NestFactory.createApplicationContext(RepairModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    await app.get(ReleaseViewKeysRepair).run();
  } catch (error) {
    new Logger('repair').error(error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
})();
