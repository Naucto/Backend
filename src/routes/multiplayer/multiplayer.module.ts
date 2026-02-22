import { UserModule } from "@user/user.module";
import { MultiplayerController } from "./multiplayer.controller";
import { MultiplayerService } from "./multiplayer.service";
import { Module } from "@nestjs/common";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ProjectModule } from "@project/project.module";

@Module({
  imports: [UserModule, ProjectModule, PrismaModule],
  controllers: [MultiplayerController],
  providers: [MultiplayerService],
  exports: [MultiplayerService]
})
export class MultiplayerModule {}
