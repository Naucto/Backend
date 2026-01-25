import { Module } from "@nestjs/common";
import { TasksService } from "./tasks/tasks.service";

@Module({
  providers: [TasksService]
})
export class TasksModule {}
