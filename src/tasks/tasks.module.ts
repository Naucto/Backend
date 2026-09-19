import { Module } from "@nestjs/common";
import { ProjectModule } from "@project/project.module";
import { TasksService } from "src/tasks/tasks/tasks.service";

@Module({
  imports: [ProjectModule],
  providers: [TasksService]
})
export class TasksModule {}
