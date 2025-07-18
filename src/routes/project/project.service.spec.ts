import { Test, TestingModule } from "@nestjs/testing";
import { ProjectService } from "./project.service";
import { S3Service } from "@s3/s3.service";
import { PrismaService } from "@prisma_naucto/prisma.service";

describe("ProjectService", () => {
  let service: ProjectService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              create: jest.fn(),
              findOne: jest.fn(),
              findAll: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: S3Service,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
