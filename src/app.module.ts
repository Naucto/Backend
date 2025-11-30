import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { S3Module } from "@s3/s3.module";
import { UserModule } from "@user/user.module";
import { ProjectModule } from "@projects/project.module";
import { WorkSessionModule } from "./routes/work-session/work-session.module";
import { PrismaModule } from "@prisma/prisma.module";
import { AuthModule } from "@auth/auth.module";
import { ScheduleModule } from "@nestjs/schedule";
import { TasksModule } from "./tasks/tasks.module";

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
  ],
})
export class AppModule {}
