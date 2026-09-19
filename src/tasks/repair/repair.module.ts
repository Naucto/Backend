import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { S3Module } from "@s3/s3.module";
import { PublishStateRepair } from "./publish-state.repair";

/**
 * Only what a one-shot repair needs: the app module would also start the WebSocket servers and
 * the crons, which have no business running from a command.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, S3Module],
  providers: [PublishStateRepair]
})
export class RepairModule {}
