import { Test, TestingModule } from "@nestjs/testing";
import { S3Controller } from "./s3.controller";
import { S3Service } from "./s3.service";
import { BucketService } from "./bucket.service";
import { CloudfrontService } from "./cloudfront.service";
import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";

describe("S3Controller", () => {
  let controller: S3Controller;

  const mockS3Client = { send: jest.fn() } as unknown as S3Client;

  const mockS3Service = {
    listBuckets: jest.fn(),
    createBucket: jest.fn(),
    deleteBucket: jest.fn(),
    generateBucketPolicy: jest.fn(),
    applyBucketPolicy: jest.fn(),
    generateSignedUrl: jest.fn(),
    createSignedCookies: jest.fn(),
    generateSignedCookies: jest.fn(),
  };

  const mockBucketService = {
    listBuckets: jest.fn(),
    createBucket: jest.fn(),
    deleteBucket: jest.fn(),
    applyBucketPolicy: jest.fn(),
    generateBucketPolicy: jest.fn(),
  };

  const mockCloudfrontService = {
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [S3Controller],
      providers: [
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: BucketService,
          useValue: mockBucketService,
        },
        {
          provide: CloudfrontService,
          useValue: mockCloudfrontService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: S3Client,
          useValue: mockS3Client,
        },
      ],
    }).compile();

    controller = module.get<S3Controller>(S3Controller);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});


