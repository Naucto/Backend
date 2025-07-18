import { Test, TestingModule } from "@nestjs/testing";
import { TasksService } from "./tasks.service";
import { PrismaModule } from "@prisma_naucto/prisma.module";

describe("TasksService", () => {
  let service: TasksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [TasksService],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
