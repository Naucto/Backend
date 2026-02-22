import { Test, TestingModule } from "@nestjs/testing";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { S3Service } from "@s3/s3.service";
import { BucketService } from "@s3/bucket.service";
import { CloudfrontService } from "@s3/cloudfront.service";

describe("ProjectController", () => {
  let controller: ProjectController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        ProjectService,
        {
          provide: PrismaService,
          useValue: {
            project: {},
            user: {},
            workSession: {},
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "S3_ENDPOINT") return "https://s3.fr-par.scw.cloud";
              if (key === "S3_REGION") return "fr-par";
              if (key === "S3_ACCESS_KEY_ID") return "test-key";
              if (key === "S3_SECRET_ACCESS_KEY") return "test-secret";
              if (key === "S3_MAX_AUTO_HISTORY_VERSION") return "5";
              if (key === "S3_AUTO_HISTORY_DELAY") return "10";
              if (key === "S3_MAX_CHECKPOINTS") return "5";
              return undefined;
            })
          }
        },
        {
          provide: S3Service,
          useValue: {}
        },
        {
          provide: BucketService,
          useValue: {}
        },
        {
          provide: CloudfrontService,
          useValue: {}
        }
      ]
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
