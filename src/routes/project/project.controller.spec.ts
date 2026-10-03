import {
  ExecutionContext,
  HttpStatus,
  INestApplication,
  NotFoundException,
  ValidationPipe
} from "@nestjs/common";
import {
  GUARDS_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA
} from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { Response } from "express";
import { Readable, Writable } from "stream";
import request from "supertest";
import { ProjectController } from "./project.controller";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import {
  ProjectCollaboratorGuard,
  ProjectCreatorGuard
} from "@auth/guards/project.guard";
import { projectIdOf } from "./project-id.decorator";
import { ProjectService } from "./project.service";
import type { ReleaseWindow } from "./project.service";
import { PROJECT_BLOB_MAX_BYTES } from "./content-size";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { S3DownloadException, S3ObjectNotFoundException } from "@s3/s3.error";
import { S3Service } from "@s3/s3.service";
import { EdgeService } from "src/routes/s3/edge.service";

const SIGNED_IN_USER = 7;
const OWN_PROJECT = 12;

describe("ProjectController", () => {
  let module: TestingModule;
  let controller: ProjectController;
  let projectService: ProjectService;

  const prisma = {
    project: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    user: {},
    workSession: {},
    $connect: jest.fn(),
    $disconnect: jest.fn()
  };
  const s3 = {
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    setObjectPublicRead: jest.fn(),
    getFileMetadataOrNull: jest.fn()
  };
  const edge = {
    getCDNUrl: jest.fn((key: string) => `https://cdn.test/${key}`)
  };

  const stored = (): { body: Readable; contentType: string; contentLength: number } => ({
    body: Readable.from(["blob"]),
    contentType: "application/octet-stream",
    contentLength: 4
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    edge.getCDNUrl.mockImplementation((key: string) => `https://cdn.test/${key}`);
    // The signed-in user collaborates on, and created, one project only.
    prisma.project.findUnique.mockImplementation(
      async ({ where }: { where: { id: number } }) =>
        where.id === OWN_PROJECT
          ? {
            id: OWN_PROJECT,
            collaborators: [{ id: SIGNED_IN_USER }],
            creator: { id: SIGNED_IN_USER }
          }
          : { id: where.id, collaborators: [], creator: { id: SIGNED_IN_USER + 1 } }
    );

    module = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        ProjectService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): string | undefined =>
              ({
                S3_MAX_AUTO_HISTORY_VERSION: "5",
                S3_AUTO_HISTORY_DELAY: "10",
                S3_MAX_CHECKPOINTS: "5"
              })[key],
            getOrThrow: (): string => "jwt-secret"
          }
        },
        { provide: S3Service, useValue: s3 },
        { provide: EdgeService, useValue: edge }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext): boolean => {
          context.switchToHttp().getRequest().user = { id: SIGNED_IN_USER };
          return true;
        }
      })
      .compile();

    controller = module.get<ProjectController>(ProjectController);
    projectService = module.get<ProjectService>(ProjectService);
  });

  describe("getRelease", () => {
    it("does not describe a project the hub does not carry", async () => {
      jest.spyOn(projectService, "fetchRelease").mockResolvedValue({
        id: 39,
        publishedAt: null
      } as unknown as Awaited<ReturnType<ProjectService["fetchRelease"]>>);

      await expect(controller.getRelease(39)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe("authorization", () => {
    const guardsOf = (method: keyof ProjectController): unknown[] =>
      (Reflect.getMetadata(GUARDS_METADATA, ProjectController.prototype[method]) ??
        []) as unknown[];

    it.each([
      "findOne",
      "getSize",
      "update",
      "saveProjectContent",
      "uploadProjectImage",
      "getProjectImage",
      "fetchProjectContent",
      "saveCheckpoint",
      "deleteCheckpoint",
      "publish",
      "unpublish",
      "updateRelease",
      "getVersions",
      "getCheckpoints",
      "deleteVersion",
      "getVersion",
      "getCheckpoint"
    ] as const)(
      "%s is open to every collaborator, not the creator alone",
      (method) => {
        expect(guardsOf(method)).toContain(ProjectCollaboratorGuard);
        expect(guardsOf(method)).not.toContain(ProjectCreatorGuard);
      }
    );

    it.each(["addCollaborator", "removeCollaborator", "remove"] as const)(
      "%s is the creator's alone",
      (method) => {
        expect(guardsOf(method)).toContain(ProjectCreatorGuard);
      }
    );

    it("reads every :id as the URL spells it, so a handler and its guard agree on the project", () => {
      const prototype = ProjectController.prototype as unknown as Record<string, object>;
      const handlers = Object.getOwnPropertyNames(prototype).filter((name) =>
        String(Reflect.getMetadata(PATH_METADATA, prototype[name]!) ?? "").includes(":id")
      );
      expect(handlers.length).toBeGreaterThan(0);

      const lenient = handlers.filter((name) => {
        const args = Object.values(
          Reflect.getMetadata(ROUTE_ARGS_METADATA, ProjectController, name) as Record<
            string,
            { factory?: unknown }
          >
        );
        return !args.some((arg) => arg.factory === projectIdOf);
      });

      expect(lenient).toEqual([]);
    });
  });

  describe("catalogue filters", () => {
    it("should ignore a release window it does not know", async () => {
      const fetchPage = jest
        .spyOn(projectService, "fetchPublishedGamesPaginated")
        .mockResolvedValue({ projects: [], total: 0, page: 1, limit: 24 });
      const count = jest
        .spyOn(projectService, "countPublishedGames")
        .mockResolvedValue(0);
      const unknown = "1y" as ReleaseWindow;

      await controller.getPaginatedReleases(
        undefined,
        undefined,
        undefined,
        undefined,
        unknown
      );
      await controller.countReleasedProjects(undefined, undefined, unknown);

      expect(fetchPage.mock.calls[0]![2]).toEqual({});
      expect(count).toHaveBeenCalledWith({});
    });

    it("should keep a release window it knows", async () => {
      const count = jest
        .spyOn(projectService, "countPublishedGames")
        .mockResolvedValue(0);

      await controller.countReleasedProjects(undefined, undefined, "30d");

      expect(count).toHaveBeenCalledWith({ releaseWindow: "30d" });
    });

    it("should fall back to the default page and limit when they are not numbers", async () => {
      const findAll = jest
        .spyOn(projectService, "findAll")
        .mockResolvedValue({ projects: [], total: 0, page: 1, limit: 24 });

      await controller.findAll(
        { user: { id: SIGNED_IN_USER } } as Parameters<ProjectController["findAll"]>[0],
        "abc",
        "many"
      );

      expect(findAll).toHaveBeenCalledWith(SIGNED_IN_USER, undefined, undefined);
    });
  });

  describe("getReleaseTags", () => {
    it("should keep a suggestion list to a handful however many are asked for", async () => {
      const fetchTags = jest
        .spyOn(projectService, "fetchPublishedTags")
        .mockResolvedValue([]);

      await controller.getReleaseTags("sn", "500");

      expect(fetchTags).toHaveBeenCalledWith("sn", 12);
    });

    it("should keep to a handful when the limit is not a number", async () => {
      const fetchTags = jest
        .spyOn(projectService, "fetchPublishedTags")
        .mockResolvedValue([]);

      await controller.getReleaseTags("sn", "abc");

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

  describe("uploadProjectImage", () => {
    it("sends nothing of the file's own name to the store", async () => {
      const file = {
        originalname: "écran.png",
        mimetype: "image/png",
        buffer: Buffer.from("png")
      } as Express.Multer.File;

      await controller.uploadProjectImage(OWN_PROJECT, file, {
        user: { id: SIGNED_IN_USER }
      } as Parameters<ProjectController["uploadProjectImage"]>[2]);

      const { metadata } = s3.uploadFile.mock.calls[0]![0] as {
        metadata: Record<string, string>;
      };
      expect(Object.values(metadata)).not.toContain("écran.png");
    });
  });

  describe("getPublishedProjectImage", () => {
    it("does not hand out the cover of a project the hub does not carry", async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(
        controller.getPublishedProjectImage(OWN_PROJECT)
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.getFileMetadataOrNull).not.toHaveBeenCalled();
    });
  });

  describe("downloads", () => {
    it("closes the connection when the stored stream fails mid-download", async () => {
      const body = new Readable({
        read(): void {
          this.push("partial");
          this.destroy(new Error("ECONNRESET mid-stream"));
        }
      });
      jest
        .spyOn(projectService, "fetchLastVersion")
        .mockResolvedValue({ ...stored(), body });
      const res = Object.assign(
        new Writable({
          write(_chunk, _encoding, done): void {
            done();
          }
        }),
        { set: jest.fn() }
      );

      await controller.fetchProjectContent(OWN_PROJECT, res as unknown as Response);
      await new Promise((resolve) => setImmediate(resolve));

      expect(res.destroyed).toBe(true);
    });
  });

  describe("over HTTP", () => {
    let app: INestApplication;
    const http = (): ReturnType<typeof request> => request(app.getHttpServer());

    beforeEach(async () => {
      app = module.createNestApplication({ logger: false });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true
        })
      );
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    // parseInt reads "12.34e2" as 12, the user's own project; Number reads it as 1234.
    it.each([
      ["get", "/projects/12.34e2", "findOne"],
      ["put", "/projects/12.34e2", "update"],
      ["delete", "/projects/12.34e2", "remove"],
      ["get", "/projects/12.34e2/size", "getContentSize"],
      ["patch", "/projects/12.34e2/add-collaborator", "addCollaborator"],
      ["delete", "/projects/12.34e2/remove-collaborator", "removeCollaborator"],
      ["patch", "/projects/12.34e2/saveContent", "save"],
      ["post", "/projects/12.34e2/image", "uploadImage"],
      ["get", "/projects/12.34e2/fetchContent", "fetchLastVersion"],
      ["post", "/projects/12.34e2/publish", "publish"],
      ["post", "/projects/12.34e2/unpublish", "unpublish"],
      ["post", "/projects/12.34e2/update-release", "updateRelease"],
      ["get", "/projects/12.34e2/versions", "listVersions"],
      ["get", "/projects/12.34e2/checkpoints", "listCheckpoints"],
      ["delete", "/projects/12.34e2/versions/1", "deleteVersion"],
      ["get", "/projects/12.34e2/versions/1", "fetchSavedVersion"],
      ["delete", "/projects/12.34e2/deleteCheckpoint/x", "removeCheckpoint"],
      ["get", "/projects/12.34e2/checkpoints/x", "fetchCheckpoint"],
      ["post", "/projects/12.34e2/saveCheckpoint/x", "save"]
    ] as const)(
      "%s %s never reaches a project other than the one the guard checked",
      async (verb, path, method) => {
        const reached = jest
          .spyOn(projectService, method)
          .mockResolvedValue(undefined as never);
        const pending = http()[verb](path);
        if (method === "save" || method === "uploadImage") {
          pending.attach("file", Buffer.from("blob"), "game.bin");
        } else if (verb !== "get") {
          pending.send({ name: "Renamed", shortDesc: "", userId: 3 });
        }

        const response = await pending;

        expect(reached).not.toHaveBeenCalled();
        expect([HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN]).toContain(
          response.status
        );
      }
    );

    it.each([
      ["get", "/projects/releases/abc"],
      ["get", "/projects/releases/abc/content"],
      ["get", "/projects/releases/abc/content-url"],
      ["post", "/projects/releases/abc/like"],
      ["delete", "/projects/releases/abc/like"],
      ["get", "/projects/releases/abc/like-status"]
    ] as const)("%s %s refuses an id that is not a number", async (verb, path) => {
      await http()[verb](path).expect(HttpStatus.BAD_REQUEST);
    });

    it("refuses an update from someone who is not on the project", async () => {
      const update = jest.spyOn(projectService, "update");

      await http()
        .put("/projects/99")
        .send({ name: "Taken over", shortDesc: "" })
        .expect(HttpStatus.FORBIDDEN);

      expect(update).not.toHaveBeenCalled();
    });

    const downloads = [
      ["/projects/releases/12/content", "fetchReleaseContent"],
      ["/projects/12/fetchContent", "fetchLastVersion"],
      ["/projects/12/versions/1", "fetchSavedVersion"],
      ["/projects/12/checkpoints/x", "fetchCheckpoint"]
    ] as const;

    it.each(downloads)("GET %s streams what the store holds", async (path, method) => {
      jest.spyOn(projectService, method).mockResolvedValue(stored());

      const response = await http().get(path).expect(HttpStatus.OK);

      expect(response.body.toString()).toBe("blob");
    });

    it.each(downloads)("GET %s answers 404 for an object the store does not hold", async (path, method) => {
      jest
        .spyOn(projectService, method)
        .mockRejectedValue(new S3ObjectNotFoundException("bucket", "key"));

      await http().get(path).expect(HttpStatus.NOT_FOUND);
    });

    it.each(downloads)("GET %s does not pass a storage failure off as a missing file", async (path, method) => {
      jest
        .spyOn(projectService, method)
        .mockRejectedValue(new S3DownloadException("bucket", "key", new Error("timeout")));

      await http().get(path).expect(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it("downloads a checkpoint whose name is not plain ASCII", async () => {
      jest.spyOn(projectService, "fetchCheckpoint").mockResolvedValue(stored());

      const response = await http()
        .get(`/projects/12/checkpoints/${encodeURIComponent("v1 – final")}`)
        .expect(HttpStatus.OK);

      expect(response.headers["content-disposition"]).toContain(
        "filename*=UTF-8''v1%20%E2%80%93%20final"
      );
      expect(response.headers["content-type"]).toBe("application/octet-stream");
      expect(response.headers).not.toHaveProperty("etag");
    });

    it("answers 400, not 500, for a checkpoint name the store would not accept", async () => {
      await http()
        .get(`/projects/12/checkpoints/${encodeURIComponent("a/b")}`)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it.each([
      ["patch", "/projects/12/saveContent", PROJECT_BLOB_MAX_BYTES],
      ["post", "/projects/12/saveCheckpoint/x", PROJECT_BLOB_MAX_BYTES],
      ["post", "/projects/12/image", 5 * 1024 * 1024]
    ] as const)(
      "%s %s stops reading an upload past its size limit",
      async (verb, path, limit) => {
        const save = jest.spyOn(projectService, "save");

        await http()[verb](path)
          .attach("file", Buffer.alloc(limit + 1), {
            filename: "a.png",
            contentType: "image/png"
          })
          .expect(HttpStatus.PAYLOAD_TOO_LARGE);

        expect(save).not.toHaveBeenCalled();
        expect(s3.uploadFile).not.toHaveBeenCalled();
      }
    );

    it("answers the status it documents when a checkpoint is deleted", async () => {
      jest.spyOn(projectService, "removeCheckpoint").mockResolvedValue();

      const response = await http()
        .delete("/projects/12/deleteCheckpoint/x")
        .expect(HttpStatus.OK);

      expect(response.body).toEqual({
        message: "Checkpoint deleted successfully",
        id: OWN_PROJECT
      });
    });
  });
});
