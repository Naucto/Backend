import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";

function projectRequestOf(context: ExecutionContext): { userId: number; projectId: number } {
  const request = context.switchToHttp().getRequest();
  const user = request.user;
  const rawProjectId: unknown = request.params.id;

  if (!user || typeof rawProjectId !== "string" || !/^\d+$/.test(rawProjectId)) {
    throw new ForbiddenException("Invalid user or project ID");
  }

  return { userId: user.id, projectId: Number(rawProjectId) };
}

@Injectable()
export class ProjectCreatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { userId, projectId } = projectRequestOf(context);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { creator: { select: { id: true } } }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.creator.id !== userId) {
      throw new ForbiddenException("You are not the creator of this project");
    }

    return true;
  }
}

@Injectable()
export class ProjectCollaboratorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { userId, projectId } = projectRequestOf(context);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { collaborators: { where: { id: userId }, select: { id: true } } }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.collaborators.length === 0) {
      throw new ForbiddenException("No access to this project");
    }

    return true;
  }
}
