import { Test, TestingModule } from "@nestjs/testing";
import { ProjectService } from "./project.service";
import { S3Service } from "@s3/s3.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";

import { CREATOR_SELECT, COLLABORATOR_SELECT } from "./project.service";
import { ProjectStatus, MonetizationType, Prisma } from "@prisma/client";
import * as Y from "yjs";
import { Readable } from "stream";
import { GAME_KEYS, PROJECT_CONTENT_MAX_BYTES } from "./content-size";
import { ProjectTooLargeException } from "./project.error";

type ProjectWithCreatorAndCollaborators = Prisma.ProjectGetPayload<{
  include: {
    creator: {
      select: typeof CREATOR_SELECT;
    };
    collaborators: {
      select: typeof COLLABORATOR_SELECT;
    };
  };
}>;

const mockProjects: ProjectWithCreatorAndCollaborators[] = [
  {
    id: 1,
    name: "Project A",
    shortDesc: "Short A",
    longDesc: "Long A",
    tags: ["Action"],
    publishedName: null,
    publishedShortDesc: null,
    publishedLongDesc: null,
    publishedTags: [],
    status: ProjectStatus.IN_PROGRESS,
    iconUrl: "https://example.com/icon-a.png",
    monetization: MonetizationType.ADS,
    price: 0,
    createdAt: new Date(),
    userId: 1,
    viewCount: 0,
    uniquePlayers: 0,
    activePlayers: 0,
    likes: 0,
    updatedAt: new Date(),
    publishedAt: null,
    contentKey: "keyA",
    contentExtension: ".zip",
    contentUploadedAt: new Date(),
    forkedFromId: null,
    contentSize: null,
    contentSizeTotal: null,
    creator: {
      id: 42,
      email: "creator@example.com",
      username: "creatorUser"
    },
    collaborators: [
      {
        id: 1,
        email: "user1@example.com",
        username: "user1"
      }
    ]
  },
  {
    id: 2,
    name: "Project B",
    shortDesc: "Short B",
    longDesc: "Long B",
    tags: ["Shooter", "Adventure"],
    publishedName: "Project B",
    publishedShortDesc: "Short B",
    publishedLongDesc: "Long B",
    publishedTags: ["Shooter", "Adventure"],
    status: ProjectStatus.COMPLETED,
    iconUrl: "https://example.com/icon-b.png",
    monetization: MonetizationType.PAID,
    price: 67.99,
    createdAt: new Date(),
    userId: 1,
    viewCount: 42,
    uniquePlayers: 10897,
    activePlayers: 600,
    likes: 187,
    updatedAt: new Date(),
    publishedAt: new Date(),
    contentKey: "keyB",
    contentExtension: ".zip",
    contentUploadedAt: new Date(),
    forkedFromId: null,
    contentSize: null,
    contentSizeTotal: null,
    creator: {
      id: 42,
      email: "creator@example.com",
      username: "creatorUser"
    },
    collaborators: [
      {
        id: 1,
        email: "user1@example.com",
        username: "user1"
      }
    ]
  }
];

describe("ProjectService", () => {
  let service: ProjectService;

  const prismaMock = {
    project: {
      aggregate: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    user: {
      findUnique: jest.fn()
    },
    like: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn()
    },
    workSession: {
      findMany: jest.fn(),
      update: jest.fn()
    },
    $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
      Promise.all(operations)
    )
  };

  const s3ServiceMock = {
    deleteFile: jest.fn(),
    listObjects: jest.fn(),
    deleteFiles: jest.fn(),
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
    setObjectPublicRead: jest.fn()
  };

  const configServiceMock = {
    get: jest.fn((key: string) => {
      if (key === "S3_MAX_AUTO_HISTORY_VERSION") return "5";
      if (key === "S3_AUTO_HISTORY_DELAY") return "10";
      if (key === "S3_MAX_CHECKPOINTS") return "5";
      return undefined;
    })
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: PrismaService,
          useValue: prismaMock
        },
        {
          provide: S3Service,
          useValue: s3ServiceMock
        },
        {
          provide: ConfigService,
          useValue: configServiceMock
        }
      ]
    }).compile();

    service = module.get<ProjectService>(ProjectService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("likeProject / unlikeProject", () => {
    it("is idempotent when liking: upserts the like and syncs the counter from a row count", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.like.upsert.mockResolvedValue({ id: 10, userId: 7, projectId: 1 });
      prismaMock.like.count.mockResolvedValue(1);
      prismaMock.project.update.mockResolvedValue({ likes: 1 });

      const result = await service.likeProject(1, 7);

      expect(prismaMock.like.upsert).toHaveBeenCalledWith({
        where: { userId_projectId: { userId: 7, projectId: 1 } },
        create: { userId: 7, projectId: 1 },
        update: {}
      });
      // Counter is recomputed from the actual rows, never incremented blindly.
      expect(prismaMock.like.count).toHaveBeenCalledWith({ where: { projectId: 1 } });
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { likes: 1 }
      });
      expect(result).toEqual({ likes: 1, liked: true });
    });

    it("rejects liking a project that does not exist", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.likeProject(999, 7)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(prismaMock.like.upsert).not.toHaveBeenCalled();
    });

    it("is idempotent when unliking: deleteMany never throws on a missing like", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.like.deleteMany.mockResolvedValue({ count: 0 });
      prismaMock.like.count.mockResolvedValue(0);
      prismaMock.project.update.mockResolvedValue({ likes: 0 });

      const result = await service.unlikeProject(1, 7);

      expect(prismaMock.like.deleteMany).toHaveBeenCalledWith({
        where: { userId: 7, projectId: 1 }
      });
      expect(result).toEqual({ likes: 0, liked: false });
    });
  });

  describe("findAll", () => {
    it("should return paginated projects for a given user", async () => {
      const userId = 1;
      const where = {
        collaborators: {
          some: { id: userId }
        }
      };

      prismaMock.project.count.mockResolvedValue(mockProjects.length);
      prismaMock.project.findMany.mockResolvedValue(mockProjects);

      const result = await service.findAll(userId);

      expect(prismaMock.project.count).toHaveBeenCalledWith({ where });
      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where,
        include: {
          collaborators: { select: ProjectService.COLLABORATOR_SELECT },
          creator: { select: ProjectService.CREATOR_SELECT }
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip: 0,
        take: 24
      });

      expect(result).toEqual({
        projects: mockProjects,
        total: mockProjects.length,
        page: 1,
        limit: 24
      });
    });

    it("should normalize page and cap limit", async () => {
      const userId = 1;

      prismaMock.project.count.mockResolvedValue(250);
      prismaMock.project.findMany.mockResolvedValue(mockProjects);

      const result = await service.findAll(userId, 2.9, 150.8);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 100,
          take: 100
        })
      );
      expect(result).toEqual({
        projects: mockProjects,
        total: 250,
        page: 2,
        limit: 100
      });
    });
  });

  describe("findOne", () => {
    it("should return the project if found", async () => {
      const projectId = 1;

      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);

      const result = await service.findOne(projectId);

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: projectId },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          collaborators: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      });
      expect(result).toEqual(mockProjects[0]);
    });

    it("should throw NotFoundException if project not found", async () => {
      const projectId = 999;

      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.findOne(projectId)).rejects.toThrow(
        NotFoundException
      );

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: projectId },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          collaborators: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      });
    });
  });

  describe("create", () => {
    it("should create and return a project", async () => {
      const userId = 1;
      const createDto = {
        name: "New Project",
        shortDesc: "Short",
        longDesc: "Long",
        status: ProjectStatus.IN_PROGRESS,
        iconUrl: "",
        monetization: MonetizationType.ADS,
        price: 0
      };

      prismaMock.user.findUnique.mockResolvedValue({ id: userId });
      prismaMock.project.create.mockResolvedValue({
        id: 10,
        ...createDto,
        collaborators: [
          { id: userId, username: "user1", email: "user1@example.com" }
        ],
        creator: { id: userId, username: "user1", email: "user1@example.com" }
      });

      const result = await service.create(createDto, userId);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId }
      });
      expect(prismaMock.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ...createDto,
            collaborators: { connect: [{ id: userId }] },
            creator: { connect: { id: userId } }
          }),
          include: expect.any(Object)
        })
      );
      expect(result).toHaveProperty("id", 10);
    });

    it("should throw NotFoundException if user not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      const createDto = {
        name: "Dummy Project",
        shortDesc: "Dummy short desc",
        longDesc: "Dummy long desc",
        status: ProjectStatus.IN_PROGRESS,
        iconUrl: "",
        monetization: MonetizationType.ADS,
        price: 0
      };

      await expect(service.create(createDto, 999)).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw InternalServerErrorException on prisma error", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.project.create.mockRejectedValue(new Error("DB error"));
      const createDto = {
        name: "Dummy Project",
        shortDesc: "Dummy short desc",
        longDesc: "Dummy long desc",
        status: ProjectStatus.IN_PROGRESS,
        iconUrl: "",
        monetization: MonetizationType.ADS,
        price: 0
      };

      await expect(service.create(createDto, 1)).rejects.toThrow(
        InternalServerErrorException
      );
    });
  });

  describe("update", () => {
    it("should update and return the project", async () => {
      const projectId = 1;
      const updateDto = {
        name: "Updated Name",
        shortDesc: "Updated short desc"
      };

      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);
      prismaMock.project.update.mockResolvedValue({
        ...mockProjects[0],
        ...updateDto
      });

      const result = await service.update(projectId, updateDto);

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: projectId },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          collaborators: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      });
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: updateDto
      });
      expect(result.name).toBe("Updated Name");
    });

    it("should throw NotFoundException if project does not exist", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);
      const updateDto = {
        name: "Updated Name",
        shortDesc: "Updated short desc"
      };

      await expect(service.update(999, updateDto)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("remove", () => {
    it("should delete the S3 file and project successfully", async () => {
      const projectId = 1;
      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);
      prismaMock.project.delete.mockResolvedValue(mockProjects[0]);
      s3ServiceMock.deleteFile.mockResolvedValue(undefined);
      s3ServiceMock.listObjects.mockResolvedValue([]);
      s3ServiceMock.deleteFiles.mockResolvedValue(undefined);

      await service.remove(projectId);

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: projectId },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          collaborators: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      });
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({
        key: `release/${projectId}`
      });
      expect(prismaMock.project.delete).toHaveBeenCalledWith({
        where: { id: projectId }
      });
    });

    it("should throw InternalServerErrorException if s3Service.deleteFile fails", async () => {
      const projectId = 1;
      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);
      s3ServiceMock.deleteFile.mockRejectedValue(new Error("S3 error"));

      await expect(service.remove(projectId)).rejects.toThrow(
        InternalServerErrorException
      );

      expect(prismaMock.project.findUnique).toHaveBeenCalled();
      expect(s3ServiceMock.deleteFile).toHaveBeenCalled();
    });

    it("should throw NotFoundException if project does not exist", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });

    it("should throw InternalServerErrorException with unknown error if s3Service.deleteFile throws non-Error", async () => {
      const projectId = 123;

      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        id: projectId
      });

      s3ServiceMock.deleteFile.mockImplementation(() => {
        throw "some string error";
      });

      await expect(service.remove(projectId)).rejects.toThrow(
        InternalServerErrorException
      );
      await expect(service.remove(projectId)).rejects.toThrow(
        `Error deleting S3 file with key ${projectId}: Unknown error`
      );

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: projectId },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          collaborators: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      });
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({
        key: `release/${projectId}`
      });
    });
  });

  describe("addCollaborator", () => {
    const addDto = { userId: 2 };

    it("should add collaborator successfully", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: 1 }, { id: 3 }]
      });
      prismaMock.project.update.mockResolvedValue(mockProjects[0]);

      const result = await service.addCollaborator(1, addDto);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: addDto.userId }
      });
      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          collaborators: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      });
      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            collaborators: { connect: { id: addDto.userId } }
          }
        })
      );
      expect(result).toEqual(mockProjects[0]);
    });

    it("should throw NotFoundException if user not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw NotFoundException if project not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw BadRequestException if user already collaborator", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: 2 }]
      });

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("removeCollaborator", () => {
    const removeDto = { userId: 2 };

    it("should remove collaborator successfully", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: 2 }, { id: 3 }]
      });
      prismaMock.project.update.mockResolvedValue(mockProjects[0]);

      const result = await service.removeCollaborator(1, removeDto);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: removeDto.userId }
      });
      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          collaborators: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      });
      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            collaborators: { disconnect: { id: removeDto.userId } }
          }
        })
      );
      expect(result).toEqual(mockProjects[0]);
    });

    it("should throw NotFoundException if user not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw NotFoundException if project not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw ForbiddenException if trying to remove creator", async () => {
      const creatorId =
        mockProjects && mockProjects[0] ? mockProjects[0].userId : 1;
      prismaMock.user.findUnique.mockResolvedValue({ id: creatorId });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: creatorId }]
      });

      await expect(
        service.removeCollaborator(1, { userId: creatorId })
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw BadRequestException if user not a collaborator", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: 3 }]
      });

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("updateLastTimeUpdate", () => {
    it("should update lastSave if sessions exist", async () => {
      const projectId = 1;
      prismaMock.workSession.findMany.mockResolvedValue([
        { id: 10 },
        { id: 11 }
      ]);
      prismaMock.workSession.update.mockResolvedValue({});

      await service.updateLastTimeUpdate(projectId);

      expect(prismaMock.workSession.findMany).toHaveBeenCalledWith({
        where: { projectId }
      });
      expect(prismaMock.workSession.update).toHaveBeenCalledWith({
        data: { lastSaveAt: expect.any(Date) },
        where: { projectId }
      });
    });

    it("should not update if no sessions", async () => {
      const projectId = 1;
      prismaMock.workSession.findMany.mockResolvedValue([]);

      await service.updateLastTimeUpdate(projectId);

      expect(prismaMock.workSession.findMany).toHaveBeenCalledWith({
        where: { projectId }
      });
      expect(prismaMock.workSession.update).not.toHaveBeenCalled();
    });
  });

  describe("fetchPublishedGamesPaginated", () => {
    const publishedProject = {
      ...mockProjects[1]!,
      _count: {
        comments: 3,
        forks: 5
      }
    };

    it("should return paginated published projects with counts", async () => {
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.project.findMany.mockResolvedValue([publishedProject]);

      const result = await service.fetchPublishedGamesPaginated(2, 1);

      expect(prismaMock.project.count).toHaveBeenCalledWith({
        where: { status: "COMPLETED" }
      });
      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where: { status: "COMPLETED" },
        include: {
          collaborators: { select: ProjectService.COLLABORATOR_SELECT },
          creator: { select: ProjectService.CREATOR_SELECT },
          _count: {
            select: {
              forks: true,
              comments: { where: { deleted: false } }
            }
          }
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: 1,
        take: 1
      });
      expect(result).toEqual({
        projects: [
          expect.objectContaining({
            id: publishedProject.id,
            name: publishedProject.publishedName,
            commentCount: 3,
            forkCount: 5
          })
        ],
        total: 1,
        page: 2,
        limit: 1
      });
    });

    it("should normalize invalid page and cap large limits", async () => {
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.project.findMany.mockResolvedValue([publishedProject]);

      const result = await service.fetchPublishedGamesPaginated(0, 500);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 100
        })
      );
      expect(result.page).toBe(1);
      expect(result.limit).toBe(100);
    });

    it("should order by the requested shelf sort", async () => {
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.project.findMany.mockResolvedValue([publishedProject]);

      await service.fetchPublishedGamesPaginated(1, 10, {}, "popular");

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ viewCount: "desc" }, { publishedAt: "desc" }]
        })
      );
    });

    it("should apply the search filter to both the page and its total", async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchPublishedGamesPaginated(1, 10, { search: "snake" });

      const where = prismaMock.project.count.mock.calls[0]![0]!.where;
      expect(where).toEqual(
        expect.objectContaining({ status: "COMPLETED", AND: expect.any(Array) })
      );
      // The same filter has to reach findMany, or page 1 of a search shows unfiltered games.
      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where })
      );
    });
  });

  describe("profile shelves", () => {
    it("should exclude games the person owns from their collaborations", async () => {
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchCollaborationsByUser(7);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "COMPLETED",
            userId: { not: 7 },
            collaborators: { some: { id: 7 } }
          }
        })
      );
    });

    it("should list remixes by the owner of what they were forked from", async () => {
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchRemixesOfUser(7);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "COMPLETED",
            userId: { not: 7 },
            forkedFrom: { userId: 7 }
          }
        })
      );
    });

    it("should sum plays and likes over owned published games", async () => {
      prismaMock.project.count.mockResolvedValue(3);
      prismaMock.project.aggregate.mockResolvedValue({
        _sum: { viewCount: 1240, likes: 318 }
      });

      await expect(service.fetchUserTotals(7)).resolves.toEqual({
        gameCount: 3,
        totalPlays: 1240,
        totalLikes: 318
      });
    });

    it("should report zeroes when a person has published nothing", async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.aggregate.mockResolvedValue({
        _sum: { viewCount: null, likes: null }
      });

      await expect(service.fetchUserTotals(7)).resolves.toEqual({
        gameCount: 0,
        totalPlays: 0,
        totalLikes: 0
      });
    });
  });
  describe("content size budget", () => {
    const encodeGame = (codeLength: number): Buffer => {
      const doc = new Y.Doc();
      doc.getMap<unknown>(GAME_KEYS.meta).set("schemaVersion", 1);
      const file = new Y.Map<unknown>();
      const text = new Y.Text();
      doc.getMap<unknown>(GAME_KEYS.codeFiles).set("main", file);
      file.set("text", text);
      text.insert(0, "x".repeat(codeLength));
      return Buffer.from(Y.encodeStateAsUpdate(doc));
    };

    const mockLastVersion = (blob: Buffer): void => {
      s3ServiceMock.listObjects.mockResolvedValue([
        { Key: "save/1/100", LastModified: new Date(100) }
      ]);
      s3ServiceMock.downloadFile.mockResolvedValue({
        body: Readable.from(blob),
        contentType: "application/octet-stream",
        contentLength: blob.byteLength
      });
    };

    it("exposes the limits", () => {
      expect(service.getLimits()).toEqual({
        maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
        maxBlobBytes: 16 * 1024 * 1024
      });
    });

    it("stores the breakdown when saving", async () => {
      s3ServiceMock.listObjects.mockResolvedValue([]);
      prismaMock.workSession.findMany.mockResolvedValue([]);
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);
      prismaMock.project.update.mockResolvedValue({});

      await service.save(1, {
        buffer: encodeGame(10)
      } as unknown as Express.Multer.File);

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          contentSize: expect.objectContaining({ code: 10, schemaVersion: 1 }),
          contentSizeTotal: 10
        }
      });
    });

    it("returns the stored breakdown without touching S3", async () => {
      const contentSize = {
        code: 5,
        sprites: 0,
        flags: 0,
        map: 0,
        sound: 0,
        palette: 0,
        total: 5,
        schemaVersion: 1
      };
      prismaMock.project.findUnique.mockResolvedValue({ contentSize });

      const result = await service.getContentSize(1);

      expect(result).toEqual({
        projectId: 1,
        contentSize,
        maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
        withinBudget: true
      });
      expect(s3ServiceMock.downloadFile).not.toHaveBeenCalled();
    });

    it("computes and persists the breakdown when it is missing", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ contentSize: null });
      prismaMock.project.update.mockResolvedValue({});
      mockLastVersion(encodeGame(7));

      const result = await service.getContentSize(1);

      expect(result.contentSize.code).toBe(7);
      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contentSizeTotal: 7 })
        })
      );
    });

    it("rejects publishing a project above the budget with a 413", async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        name: "Big",
        shortDesc: "",
        longDesc: null,
        tags: []
      });
      prismaMock.project.update.mockResolvedValue({});
      mockLastVersion(encodeGame(PROJECT_CONTENT_MAX_BYTES + 1));

      await expect(service.publish(1)).rejects.toBeInstanceOf(
        ProjectTooLargeException
      );

      const calls = prismaMock.project.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      expect(calls.some((call) => call[0].data["status"] === "COMPLETED")).toBe(
        false
      );
      expect(s3ServiceMock.uploadFile).not.toHaveBeenCalled();
    });

    it("publishes a project within the budget", async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        name: "Small",
        shortDesc: "",
        longDesc: null,
        tags: []
      });
      prismaMock.project.update.mockResolvedValue({});
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);
      s3ServiceMock.setObjectPublicRead.mockResolvedValue(undefined);
      mockLastVersion(encodeGame(3));

      await service.publish(1);

      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" })
        })
      );
      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ keyName: "release/1" })
      );
    });

    it("lists projects without a breakdown", async () => {
      prismaMock.project.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }]);

      await expect(service.findProjectsWithoutContentSize(2)).resolves.toEqual([
        3, 4
      ]);
      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where: { contentSizeTotal: null },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 2
      });
    });
  });
});
