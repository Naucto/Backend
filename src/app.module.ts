import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { S3Module } from './routes/s3/s3.module';
import { UserModule } from './routes/user/user.module';
import { ProjectModule } from './routes/project/project.module';
import { WorkSessionModule } from './routes/work-session/work-session.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    S3Module,
    UserModule,
    ProjectModule,
    WorkSessionModule,
  ],
})
export class AppModule {}
