import { Module } from '@nestjs/common';

import { ProjectModule } from '../routes/project/project.module';
import { WorkSessionModule } from '../routes/work-session/work-session.module';
import { TasksService } from './tasks/tasks.service';

@Module({
  imports: [ProjectModule, WorkSessionModule],
  providers: [TasksService],
})
export class TasksModule {}
