import { Module } from "@nestjs/common";
import { UserService } from "./user.service";
import { AccountDeletionService } from "./account-deletion.service";
import { UserController } from "./user.controller";
import { UserPublicController } from "./user.public.controller";
import { S3Module } from "@s3/s3.module";
import { ProjectModule } from "@project/project.module";

@Module({
  imports: [S3Module, ProjectModule],
  controllers: [UserController, UserPublicController],
  providers: [UserService, AccountDeletionService],
  exports: [UserService]
})
export class UserModule {}
