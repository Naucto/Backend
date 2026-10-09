import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../../routes/s3/s3.module';
import { PublishStateRepair } from './publish-state.repair';
import { ReleaseViewKeysRepair } from './release-view-keys.repair';

/**
 * Only what a one-shot repair needs: the app module would also start the WebSocket servers and
 * the crons, which have no business running from a command.
 */
@Module({
  imports: [PrismaModule, S3Module],
  providers: [PublishStateRepair, ReleaseViewKeysRepair],
})
export class RepairModule {}
