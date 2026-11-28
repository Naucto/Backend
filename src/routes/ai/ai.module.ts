import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectModule } from '../project/project.module';
import {
  AiGrantsController,
  AiMcpController,
  AiOAuthController,
  AiProjectController,
} from './ai.controller';
import { AiService } from './ai.service';
import { AiJobsService } from './ai-jobs.service';
import { AiWorkspaceService } from './ai-workspace.service';

@Module({
  imports: [PrismaModule, ProjectModule],
  controllers: [AiOAuthController, AiGrantsController, AiProjectController, AiMcpController],
  providers: [AiService, AiWorkspaceService, AiJobsService],
})
export class AiModule {}
