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
    status: ProjectStatus.IN_PROGRESS,
    iconUrl: "https://example.com/icon-a.png",
    monetization: MonetizationType.ADS,
    price: 0,
    createdAt: new Date(),
    userId: 1,
    uniquePlayers: 0,
    activePlayers: 0,
    likes: 0,
    contentKey: "keyA",
    contentExtension: ".zip",
    contentUploadedAt: new Date(),
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
    status: ProjectStatus.COMPLETED,
    iconUrl: "https://example.com/icon-b.png",
    monetization: MonetizationType.PAID,
    price: 67.99,
    createdAt: new Date(),
    userId: 1,
    uniquePlayers: 10897,
    activePlayers: 600,
    likes: 187,
    contentKey: "keyB",
    contentExtension: ".zip",
    contentUploadedAt: new Date(),
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
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    user: {
      findUnique: jest.fn()
    },
    workSession: {
      findMany: jest.fn(),
      update: jest.fn()
    }
  };

  const s3ServiceMock = {
    deleteFile: jest.fn(),
    listObjects: jest.fn(),
    deleteFiles: jest.fn()
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

  describe("findAll", () => {
    it("should return a list of projects for a given user", async () => {
      const userId = 1;

      prismaMock.project.findMany.mockResolvedValue(mockProjects);

      const result = await service.findAll(userId);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where: {
          collaborators: {
            some: { id: userId }
          }
        },
        include: {
          collaborators: { select: ProjectService.COLLABORATOR_SELECT },
          creator: { select: ProjectService.CREATOR_SELECT }
        }
      });

      expect(result).toEqual(mockProjects);
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

      await expect(
        service.removeCollaborator(1, removeDto)
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if project not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(
        service.removeCollaborator(1, removeDto)
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if trying to remove creator", async () => {
      const creatorId = (mockProjects && mockProjects[0]) ? mockProjects[0].userId : 1;
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

      await expect(
        service.removeCollaborator(1, removeDto)
      ).rejects.toThrow(BadRequestException);
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
        data: { lastSave: expect.any(Date) },
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
});
