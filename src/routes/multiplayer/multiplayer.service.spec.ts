import { ProjectService } from "@project/project.service";
import { UserService } from "@user/user.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { S3Service } from "@s3/s3.service";
import { MultiplayerService } from "./multiplayer.service";
import { Test } from "@nestjs/testing";

describe("MultiplayerService", () => {
  let service: MultiplayerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MultiplayerService,
        ProjectService,
        UserService,
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
        }
      ]
    }).compile();

    service = module.get<MultiplayerService>(MultiplayerService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("lookupHosts", () => {

  });
});
