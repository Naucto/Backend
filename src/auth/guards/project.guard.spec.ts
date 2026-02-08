import { Test, TestingModule } from "@nestjs/testing";
import { ProjectCreatorGuard, ProjectCollaboratorGuard } from "./project.guard";
import { PrismaService } from "@prisma/prisma.service";
import { ExecutionContext, ForbiddenException, NotFoundException } from "@nestjs/common";

describe("ProjectCreatorGuard", () => {
  let guard: ProjectCreatorGuard;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectCreatorGuard,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          },
        },
      ],
    }).compile();

    guard = module.get<ProjectCreatorGuard>(ProjectCreatorGuard);
    prismaService = module.get<PrismaService>(PrismaService) as any;
  });

  const createMockContext = (user: any, projectId: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: user,
          params: { id: projectId },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  describe("canActivate", () => {
    it("should throw ForbiddenException when user is not authenticated", async () => {
      const context = createMockContext(null, "1");
      
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when projectId is invalid", async () => {
      const context = createMockContext({ id: 1 }, "invalid");
      
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when project is not found", async () => {
      (prismaService.project.findUnique as jest.Mock).mockResolvedValue(null);
      const context = createMockContext({ id: 1 }, "1");
      
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user is not the creator", async () => {
      (prismaService.project.findUnique as jest.Mock).mockResolvedValue({
        creator: { id: 2 },
      });
      const context = createMockContext({ id: 1 }, "1");
      
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("should return true when user is the creator", async () => {
      (prismaService.project.findUnique as jest.Mock).mockResolvedValue({
        creator: { id: 1 },
      });
      const context = createMockContext({ id: 1 }, "1");
      
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });
});

describe("ProjectCollaboratorGuard", () => {
  let guard: ProjectCollaboratorGuard;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectCollaboratorGuard,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          },
        },
      ],
    }).compile();

    guard = module.get<ProjectCollaboratorGuard>(ProjectCollaboratorGuard);
    prismaService = module.get<PrismaService>(PrismaService) as any;
  });

  const createMockContext = (user: any, projectId: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: user,
          params: { id: projectId },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  describe("canActivate", () => {
    it("should throw ForbiddenException when user is not authenticated", async () => {
      const context = createMockContext(null, "1");
      
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when projectId is invalid", async () => {
      const context = createMockContext({ id: 1 }, "invalid");
      
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when project is not found", async () => {
      (prismaService.project.findUnique as jest.Mock).mockResolvedValue(null);
      const context = createMockContext({ id: 1 }, "1");
      
      await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user is not a collaborator", async () => {
      (prismaService.project.findUnique as jest.Mock).mockResolvedValue({
        collaborators: [{ id: 2 }, { id: 3 }],
      });
      const context = createMockContext({ id: 1 }, "1");
      
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("should return true when user is a collaborator", async () => {
      (prismaService.project.findUnique as jest.Mock).mockResolvedValue({
        collaborators: [{ id: 1 }, { id: 2 }],
      });
      const context = createMockContext({ id: 1 }, "1");
      
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });
});