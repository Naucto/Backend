import { Test, TestingModule } from "@nestjs/testing";
import { S3Controller } from "./s3.controller";
import { S3Service } from "./s3.service";
import { ConfigModule } from "@nestjs/config";

describe("S3Controller", () => {
  let controller: S3Controller;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      controllers: [S3Controller],
      providers: [S3Service],
    }).compile();

    controller = module.get<S3Controller>(S3Controller);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
