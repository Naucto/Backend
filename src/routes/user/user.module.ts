import { Module } from "@nestjs/common";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { UserPublicController } from "./user.public.controller";
import { S3Module } from "@s3/s3.module";

@Module({
  imports: [S3Module],
  controllers: [UserController, UserPublicController],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
