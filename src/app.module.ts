import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { S3Module } from './routes/aws/s3.module';
import { UserModule } from './routes/user/user.module';
import { ProjectModule } from './routes/project/project.module';
import {PrismaModule} from "./prisma/prisma.module";
import { WorkSessionModule } from './routes/work-session/work-session.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    S3Module,
    UserModule,
    ProjectModule,
    WorkSessionModule,
  ],
})
export class AppModule {}
