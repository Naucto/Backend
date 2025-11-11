import { Test, TestingModule } from "@nestjs/testing";
import { WorkSessionService } from "./work-session.service";
import { PrismaModule } from "@prisma_naucto/prisma.module";

describe("WorkSessionService", () => {
  let service: WorkSessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [WorkSessionService],
    }).compile();

    service = module.get<WorkSessionService>(WorkSessionService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
