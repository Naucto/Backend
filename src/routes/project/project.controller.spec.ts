import { Test, TestingModule } from "@nestjs/testing";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";
import { PrismaModule } from "@prisma/prisma.module";
import { S3Module } from "@s3/s3.module";

describe("ProjectController", () => {
  let controller: ProjectController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, S3Module],
      controllers: [ProjectController],
      providers: [ProjectService]
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
