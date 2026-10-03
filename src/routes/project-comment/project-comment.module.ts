import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectCommentController } from './project-comment.controller';
import { ProjectCommentService } from './project-comment.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectCommentController],
  providers: [ProjectCommentService],
})
export class ProjectCommentModule {}
