import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { S3Module } from "@s3/s3.module";

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [PublicController]
})
export class PublicModule {}
