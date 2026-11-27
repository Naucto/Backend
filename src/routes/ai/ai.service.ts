import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AiKey, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AiConnectionDto,
  AiKeyCreatedDto,
  AiKeySummaryDto,
  AiReachableProjectDto,
} from './dto/ai.dto';

/** Who a key belongs to and which of their projects a request is about. */
export interface AiConnection {
  projectId: string;
  userId: string;
}

/** How many live keys an account may hold: a key list is no place for keys nobody revokes. */
const LIVE_KEYS_MAX = 20;
/** How often `lastUsedAt` is written: every MCP call would write otherwise, and "roughly" will do. */
const LAST_USED_EVERY_MS = 60_000;
const TOKEN = /^Bearer (naucto_k_[a-f0-9]{64})$/;

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

const summaryOf = (key: AiKey): AiKeySummaryDto => ({
  id: key.id,
  name: key.name,
  expiresAt: key.expiresAt,
  createdAt: key.createdAt,
  lastUsedAt: key.lastUsedAt,
});

/**
 * Assistant keys and what they reach. A key is the account's and reaches every project the account
 * owns: there is no per-project token, so nothing is left dangling when a collaborator comes or
 * goes. A project a person only collaborates on is not lent to their assistant.
 */
@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  /** The owner or a collaborator, who may review what the assistant made. */
  async authorize(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, OR: [{ userId }, { collaborators: { some: { id: userId } } }] },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project unavailable');
    }
  }

  async createKey(userId: string, name: string, expiresInDays?: number): Promise<AiKeyCreatedDto> {
    const live = await this.prisma.aiKey.count({ where: { userId, revokedAt: null } });
    if (live >= LIVE_KEYS_MAX) {
      throw new BadRequestException(`${LIVE_KEYS_MAX} keys at most - revoke one you no longer use`);
    }
    const token = `naucto_k_${randomBytes(32).toString('hex')}`;
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
    const key = await this.prisma.aiKey.create({
      data: { tokenHash: hash(token), userId, name, expiresAt },
    });
    return { ...summaryOf(key), token };
  }

  async listKeys(userId: string): Promise<AiKeySummaryDto[]> {
    const keys = await this.prisma.aiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(summaryOf);
  }

  /** One call kills the key everywhere: a leaked key is why it has to be one call. */
  async revokeKey(userId: string, keyId: string): Promise<void> {
    const revoked = await this.prisma.aiKey.updateMany({
      where: { id: keyId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new NotFoundException('No such key');
    }
  }

  private async keyOf(authorization: string | undefined): Promise<AiKey> {
    const token = authorization?.match(TOKEN)?.[1];
    const key = token
      ? await this.prisma.aiKey.findUnique({ where: { tokenHash: hash(token) } })
      : null;
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) {
      throw new UnauthorizedException();
    }
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
      void this.prisma.aiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return key;
  }

  private ownedBy(userId: string, projectHint?: string): Prisma.ProjectWhereInput {
    if (projectHint !== undefined && projectHint !== '' && !isUUID(projectHint)) {
      throw new UnauthorizedException('This key does not reach that project');
    }
    return { userId, ...(projectHint ? { id: projectHint.toLowerCase() } : {}) };
  }

  /**
   * The project a request with this key is about: the one `X-Naucto-Project` names, or the only
   * one the account owns. With several and none named, the server will not guess.
   */
  async connection(
    authorization?: string,
    projectHint?: string,
  ): Promise<AiConnection & AiConnectionDto> {
    const key = await this.keyOf(authorization);
    const reachable = await this.prisma.project.findMany({
      where: this.ownedBy(key.userId, projectHint),
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 2,
    });
    const [project] = reachable;
    if (!project) {
      throw new UnauthorizedException(
        projectHint ? 'This key does not reach that project' : 'This account owns no project',
      );
    }
    if (reachable.length > 1) {
      throw new ConflictException('This key reaches several projects: send X-Naucto-Project');
    }
    return {
      projectId: project.id,
      userId: key.userId,
      name: project.name,
      expiresAt: key.expiresAt,
    };
  }

  /** Every project the key reaches, whatever project the request names. */
  async reachable(authorization?: string): Promise<AiReachableProjectDto[]> {
    const key = await this.keyOf(authorization);
    const projects = await this.prisma.project.findMany({
      where: this.ownedBy(key.userId),
      select: { id: true, name: true, aiWorkspace: { select: { updatedAt: true } } },
      orderBy: { id: 'asc' },
    });
    return projects.map((project) => ({
      projectId: project.id,
      name: project.name,
      draftUpdatedAt: project.aiWorkspace?.updatedAt ?? null,
    }));
  }
}
