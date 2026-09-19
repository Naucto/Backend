import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ProjectController } from "./project.controller";
import {
  ProjectCollaboratorGuard,
  ProjectCreatorGuard
} from "@auth/guards/project.guard";
import { ProjectService } from "./project.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "src/routes/s3/edge.service";

describe("ProjectController", () => {
  let controller: ProjectController;
  let projectService: ProjectService;

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
          provide: CloudfrontService,
          useValue: {}
        }
      ]
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
    projectService = module.get<ProjectService>(ProjectService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getRelease", () => {
    it("does not describe a project the hub does not carry", async () => {
      jest.spyOn(projectService, "fetchRelease").mockResolvedValue({
        id: 39,
        publishedAt: null
      } as unknown as Awaited<ReturnType<ProjectService["fetchRelease"]>>);

      await expect(controller.getRelease("39")).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe("release routes", () => {
    it.each(["publish", "unpublish", "updateRelease"] as const)(
      "%s is open to every collaborator, not the creator alone",
      (method) => {
        const guards = Reflect.getMetadata(
          "__guards__",
          ProjectController.prototype[method]
        ) as unknown[];

        expect(guards).toContain(ProjectCollaboratorGuard);
        expect(guards).not.toContain(ProjectCreatorGuard);
      }
    );
  });

  describe("getReleaseTags", () => {
    it("should keep a suggestion list to a handful however many are asked for", async () => {
      const fetchTags = jest
        .spyOn(projectService, "fetchPublishedTags")
        .mockResolvedValue([]);

      await controller.getReleaseTags("sn", "500");

      expect(fetchTags).toHaveBeenCalledWith("sn", 12);
    });

    it("should ask for every tag when nothing was typed", async () => {
      const fetchTags = jest
        .spyOn(projectService, "fetchPublishedTags")
        .mockResolvedValue([{ tag: "snake", count: 4 }]);

      const result = await controller.getReleaseTags();

      expect(fetchTags).toHaveBeenCalledWith("", 12);
      expect(result).toEqual({ tags: [{ tag: "snake", count: 4 }] });
    });
  });
});
