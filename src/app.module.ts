import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { S3Module } from "@s3/s3.module";
import { UserModule } from "@user/user.module";
import { ProjectModule } from "@project/project.module";
import { WorkSessionModule } from "@work-session/work-session.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { AuthModule } from "@auth/auth.module";
import { ScheduleModule } from "@nestjs/schedule";
import { TasksModule } from "src/tasks/tasks.module";
import { AppConfig } from "src/app.config";
import { WebRTCModule } from "@webrtc/webrtc.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    S3Module,
    UserModule,
    ProjectModule,
    WorkSessionModule,
    TasksModule,
    WebRTCModule
  ],
  providers: [
    AppConfig
  ],
  exports: [AppConfig]
})
export class AppModule {}
