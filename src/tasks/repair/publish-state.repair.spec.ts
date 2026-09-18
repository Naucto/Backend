import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Service } from "@s3/s3.service";
import { PublishStateRepair } from "./publish-state.repair";

describe("PublishStateRepair", () => {
  let repair: PublishStateRepair;

  const prismaMock = {
    project: {
      findMany: jest.fn(),
      update: jest.fn()
    }
  };
  const s3Mock = {
    fileExists: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishStateRepair,
        { provide: PrismaService, useValue: prismaMock },
        { provide: S3Service, useValue: s3Mock }
      ]
    }).compile();

    repair = module.get(PublishStateRepair);
  });

  it("resets a row whose release blob is gone, and leaves a whole one alone", async () => {
    prismaMock.project.findMany.mockResolvedValue([{ id: 2 }, { id: 39 }]);
    s3Mock.fileExists.mockImplementation((key: string) =>
      Promise.resolve(key === "release/2")
    );
    prismaMock.project.update.mockResolvedValue({});

    await expect(repair.run()).resolves.toEqual([39]);

    expect(prismaMock.project.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 39 },
      data: { publishedAt: null, status: "IN_PROGRESS" }
    });
  });

  it("finds nothing to do on a second run", async () => {
    prismaMock.project.findMany.mockResolvedValue([{ id: 2 }]);
    s3Mock.fileExists.mockResolvedValue(true);

    await expect(repair.run()).resolves.toEqual([]);

    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });
});
