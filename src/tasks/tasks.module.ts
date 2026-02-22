import { Module } from "@nestjs/common";
import { TasksService } from "src/tasks/tasks/tasks.service";

@Module({
  providers: [TasksService]
})
export class TasksModule {}
