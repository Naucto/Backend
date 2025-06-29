import { Module } from "@nestjs/common";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { S3Module } from "../s3/s3.module";

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService]
})
export class ProjectModule {}
