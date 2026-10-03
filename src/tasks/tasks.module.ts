import { Module } from '@nestjs/common';

import { ProjectModule } from '../routes/project/project.module';
import { TasksService } from './tasks/tasks.service';

@Module({
  imports: [ProjectModule],
  providers: [TasksService],
})
export class TasksModule {}
