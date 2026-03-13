import { Test, TestingModule } from "@nestjs/testing";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "src/routes/s3/edge.service";
import { ConfigService } from "@nestjs/config";

describe("UserController", () => {
  let controller: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn(),
            user: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn()
            }
          }
        },
        {
          provide: S3Service,
          useValue: {
            uploadFile: jest.fn(),
            fileExists: jest.fn(),
            downloadFile: jest.fn(),
            deleteFile: jest.fn()
          }
        },
        {
          provide: CloudfrontService,
          useValue: {
            getCDNUrl: jest.fn(),
            createSignedCookies: jest.fn(),
            getCookieDomain: jest.fn(),
            generateSignedUrl: jest.fn()
          }
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
