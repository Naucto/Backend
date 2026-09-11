import { Test, TestingModule } from "@nestjs/testing";
import { TasksService } from "./tasks.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ProjectService } from "@project/project.service";

describe("TasksService", () => {
  let service: TasksService;

  const projectServiceMock = {
    findProjectsWithoutContentSize: jest.fn(),
    recomputeContentSize: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        },
        {
          provide: ProjectService,
          useValue: projectServiceMock
        }
      ]
    }).compile();

    service = module.get<TasksService>(TasksService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("backfillProjectContentSizes", () => {
    it("recomputes every project lacking a breakdown and survives failures", async () => {
      projectServiceMock.findProjectsWithoutContentSize.mockResolvedValue([
        1, 2, 3
      ]);
      projectServiceMock.recomputeContentSize
        .mockResolvedValueOnce({ total: 1 })
        .mockRejectedValueOnce(new Error("no save"))
        .mockResolvedValueOnce({ total: 3 });

      await expect(service.backfillProjectContentSizes()).resolves.toBe(2);

      expect(projectServiceMock.recomputeContentSize).toHaveBeenCalledTimes(3);
    });

    it("does nothing when every project is already measured", async () => {
      projectServiceMock.findProjectsWithoutContentSize.mockResolvedValue([]);

      await expect(service.backfillProjectContentSizes()).resolves.toBe(0);
      expect(projectServiceMock.recomputeContentSize).not.toHaveBeenCalled();
    });
  });
});
