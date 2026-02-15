import { Test, TestingModule } from "@nestjs/testing";
import { WorkSessionService } from "./work-session.service";
import { PrismaService } from "@ourPrisma/prisma.service";

describe("WorkSessionService", () => {
  let service: WorkSessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkSessionService,
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<WorkSessionService>(WorkSessionService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
