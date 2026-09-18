import { ExecutionContext, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ProjectCollaboratorGuard, ProjectCreatorGuard } from "./project.guard";

const contextFor = (userId: number | undefined, id: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user: userId === undefined ? undefined : { id: userId }, params: { id } })
    })
  }) as unknown as ExecutionContext;

describe("project guards", () => {
  const prisma = { project: { findUnique: jest.fn() } };
  const collaborator = new ProjectCollaboratorGuard(prisma as unknown as PrismaService);
  const creator = new ProjectCreatorGuard(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("ProjectCollaboratorGuard", () => {
    it("lets a collaborator through", async () => {
      prisma.project.findUnique.mockResolvedValue({ collaborators: [{ id: 2 }, { id: 9 }] });

      await expect(collaborator.canActivate(contextFor(9, "5"))).resolves.toBe(true);
    });

    it("refuses a stranger", async () => {
      prisma.project.findUnique.mockResolvedValue({ collaborators: [{ id: 2 }] });

      await expect(collaborator.canActivate(contextFor(9, "5"))).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("says when the project does not exist", async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(collaborator.canActivate(contextFor(9, "5"))).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe("ProjectCreatorGuard", () => {
    it("refuses a collaborator who did not create the project", async () => {
      prisma.project.findUnique.mockResolvedValue({ creator: { id: 2 } });

      await expect(creator.canActivate(contextFor(9, "5"))).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });
  });
});
