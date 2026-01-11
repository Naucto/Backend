import { Test, TestingModule } from "@nestjs/testing";
import { ProjectService } from "./project.service";
import { S3Service } from "@s3/s3.service";
import { PrismaService } from "@prisma/prisma.service";
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { ProjectStatus, MonetizationType } from "@prisma/client";

const EXPECTED_INCLUDE = {
  collaborators: {
    select: { email: true, id: true, username: true },
  },
  creator: {
    select: { email: true, id: true, username: true },
  },
};

const mockProjects: any[] = [
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
    contentKey: "file-key-1", 
    contentExtension: null,
    contentUploadedAt: null,
    creator: {
      id: 42,
      email: "creator@example.com",
      username: "creatorUser",
    },
    collaborators: [
      {
        id: 1,
        email: "user1@example.com",
        username: "user1",
      },
    ],
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
    contentKey: "key-1",
    contentExtension: null,
    contentUploadedAt: null,
    creator: {
      id: 42,
      email: "creator@example.com",
      username: "creatorUser",
    },
    collaborators: [
      {
        id: 1,
        email: "user1@example.com",
        username: "user1",
      },
    ],
  },
];

describe("ProjectService", () => {
  let service: ProjectService;

  const prismaMock = {
    project: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    workSession: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const s3ServiceMock = {
    deleteFile: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: S3Service,
          useValue: s3ServiceMock,
        },
      ],
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
            some: { id: userId },
          },
        },
        include: {
          collaborators: { select: ProjectService.COLLABORATOR_SELECT },
          creator: { select: ProjectService.CREATOR_SELECT },
        },
      });

      expect(result).toEqual(mockProjects);
    });
  });

  describe("findOne", () => {
    it("should return the project if found", async () => {
      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);
      await service.findOne(1);
      
      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: EXPECTED_INCLUDE, 
      });
    });

    it("should throw NotFoundException if project not found", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
      
      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
        include: EXPECTED_INCLUDE,
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
        price: 0,
      };

      prismaMock.user.findUnique.mockResolvedValue({ id: userId });
      prismaMock.project.create.mockResolvedValue({
        id: 10,
        ...createDto,
        collaborators: [{ id: userId, username: "user1", email: "user1@example.com" }],
        creator: { id: userId, username: "user1", email: "user1@example.com" },
      });

      const result = await service.create(createDto, userId);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: userId } });
      expect(prismaMock.project.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          ...createDto,
          collaborators: { connect: [{ id: userId }] },
          creator: { connect: { id: userId } },
        }),
        include: expect.any(Object),
      }));
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
        price: 0,
      };

      await expect(service.create(createDto, 999)).rejects.toThrow(NotFoundException);
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
        price: 0,
      };

      await expect(service.create(createDto, 1)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("update", () => {
    it("should update and return the project", async () => {
      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);
      prismaMock.project.update.mockResolvedValue(mockProjects[0]);
      
      const updatePayload = { name: "New", shortDesc: "New description" };
      await service.update(1, updatePayload);

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({ 
        where: { id: 1 },
        include: EXPECTED_INCLUDE 
      });
      
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: updatePayload,
      });
    });

    it("should throw NotFoundException if project does not exist", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);
      const updateDto = {
        name: "Updated Name",
        shortDesc: "Updated short desc",
      };

      await expect(service.update(999, updateDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe("remove", () => {
    it("should delete the S3 file and project successfully", async () => {
      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);
      await service.remove(1);

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({ 
        where: { id: 1 },
        include: EXPECTED_INCLUDE 
      });
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith("file-key-1");
      expect(prismaMock.project.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
 
    it("should throw InternalServerErrorException if s3Service.deleteFile fails", async () => {
      prismaMock.project.findUnique.mockResolvedValue(mockProjects[0]);
      s3ServiceMock.deleteFile.mockRejectedValue(new Error("S3 error"));

      await expect(service.remove(1)).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw NotFoundException if project does not exist", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe("addCollaborator", () => {
    const addDto = { userId: 2 };

    it("should add collaborator successfully", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({ ...mockProjects[0], collaborators: [] });
      prismaMock.project.update.mockResolvedValue(mockProjects[0]);

      await service.addCollaborator(1, { userId: 2 });

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: EXPECTED_INCLUDE,
      });
    });

    it("should throw NotFoundException if user not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if project not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException if user already collaborator", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: 2 }],
      });

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe("removeCollaborator", () => {
    const removeDto = { userId: 2 };
    const initiator = 1;

    it("should remove collaborator successfully", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({ ...mockProjects[0], collaborators: [{ id: 2 }] });
      prismaMock.project.update.mockResolvedValue(mockProjects[0]);

      await service.removeCollaborator(1, { userId: 2 });

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: EXPECTED_INCLUDE,
      });
    });

    it("should throw NotFoundException if user not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if project not found", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if trying to remove creator", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: initiator });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: initiator }],
      });

      await expect(service.removeCollaborator(1, { userId: initiator })).rejects.toThrow(ForbiddenException);
    });

    it("should throw BadRequestException if user not a collaborator", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...mockProjects[0],
        collaborators: [{ id: 3 }],
      });

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateLastTimeUpdate", () => {
    it("should update lastSave if sessions exist", async () => {
      const projectId = 1;
      prismaMock.workSession.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      prismaMock.workSession.update.mockResolvedValue({});

      await service.updateLastTimeUpdate(projectId);

      expect(prismaMock.workSession.findMany).toHaveBeenCalledWith({ where: { projectId } });
      expect(prismaMock.workSession.update).toHaveBeenCalledWith({
        data: { lastSave: expect.any(Date) },
        where: { projectId },
      });
    });

    it("should not update if no sessions", async () => {
      const projectId = 1;
      prismaMock.workSession.findMany.mockResolvedValue([]);

      await service.updateLastTimeUpdate(projectId);

      expect(prismaMock.workSession.findMany).toHaveBeenCalledWith({ where: { projectId } });
      expect(prismaMock.workSession.update).not.toHaveBeenCalled();
    });
  });
});
