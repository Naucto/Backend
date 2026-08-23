import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Actor } from "@auth/actor";

@Injectable()
export class ProjectCreatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const projectId = parseInt(request.params.id, 10);

    if (!user || isNaN(projectId)) {
      throw new ForbiddenException("Invalid user or project ID");
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { creator: { select: { id: true } } }
    });

    if (!project) {
      throw new ForbiddenException("Project not found");
    }

    if (project.creator.id !== user.id) {
      throw new ForbiddenException("You are not the creator of this project");
    }

    return true;
  }
}

/**
 * Grants access to a project's own routes.
 *
 * Collaborators pass because it is their project; moderators pass because
 * acting on content that is not theirs is the point of the role. Routing
 * moderators through the ordinary endpoints keeps one set of routes per
 * resource instead of a parallel admin copy -- the audit log records who
 * actually acted.
 */
@Injectable()
export class ProjectCollaboratorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const projectId = parseInt(request.params.id, 10);

    if (!user || isNaN(projectId)) {
      throw new ForbiddenException("Invalid user or project ID");
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { collaborators: true }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const actor = Actor.from(user);
    const isCollaborator = project.collaborators.some((c) => c.id === actor.id);

    if (!isCollaborator && !actor.isModerator) {
      throw new ForbiddenException("No access to this project");
    }

    return true;
  }
}
