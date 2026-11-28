import { createHash, randomBytes, randomInt } from 'node:crypto';

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AiGrant, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

import { getOptionalEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AiConnectionDto,
  AiDeviceAuthorizationDto,
  AiDeviceRequestDto,
  AiGrantDto,
  AiReachableProjectDto,
  AiTokenDto,
  AiTokenErrorCode,
} from './dto/ai.dto';

/** Who a grant belongs to and which of their projects a request is about. */
export interface AiConnection {
  projectId: string;
  userId: string;
}

/** A code lives this long; an access token, an hour; a refresh token, as long as it keeps being used. */
const DEVICE_CODE_SECONDS = 15 * 60;
const ACCESS_SECONDS = 60 * 60;
/** How often the waiting assistant may ask; faster is told to slow down. */
const POLL_SECONDS = 5;
/** How often `lastUsedAt` is written: every MCP call would write otherwise, and "roughly" will do. */
const LAST_USED_EVERY_MS = 60_000;
/** Letters a person cannot misread for one another: no 0/O, 1/I/L, 5/S, 2/Z, 8/B. */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
const ACCESS = /^Bearer (naucto_at_[a-f0-9]{64})$/;

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const token = (kind: 'at' | 'rt' | 'dc'): string =>
  `naucto_${kind}_${randomBytes(32).toString('hex')}`;

/** XXXX-XXXX from the unambiguous alphabet. */
function userCodeOf(): string {
  // randomInt draws without the bias a modulo on random bytes would give some letters.
  const letters = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return `${letters.slice(0, 4).join('')}-${letters.slice(4).join('')}`;
}

/** An answer of the token endpoint that is not tokens, in the shape RFC 8628 and RFC 6749 give it. */
export class AiTokenError extends HttpException {
  constructor(
    readonly code: AiTokenErrorCode,
    description: string,
  ) {
    super({ error: code, error_description: description }, HttpStatus.BAD_REQUEST);
  }
}

const grantOf = (grant: AiGrant): AiGrantDto => ({
  id: grant.id,
  clientName: grant.clientName,
  createdAt: grant.createdAt,
  lastUsedAt: grant.lastUsedAt,
});

/**
 * How an assistant reaches an account: the OAuth device flow (RFC 8628). The assistant asks for a
 * code, shows it, and waits; the owner types it on Naucto and approves; the assistant then gets
 * an access token and a refresh token. Nothing is copied by hand and nothing lives forever: the
 * access token lasts an hour, the refresh token is replaced each time it is used, and a grant is
 * revoked from the settings. A grant reaches every project the account owns, never one it only
 * collaborates on.
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

  // ---- the device flow ----------------------------------------------------------------------

  async startDevice(request: AiDeviceRequestDto): Promise<AiDeviceAuthorizationDto> {
    const deviceCode = token('dc');
    const userCode = userCodeOf();
    await this.prisma.aiDeviceCode.create({
      data: {
        deviceCodeHash: hash(deviceCode),
        userCode,
        clientName: (request.clientName ?? 'Assistant').slice(0, 80),
        expiresAt: new Date(Date.now() + DEVICE_CODE_SECONDS * 1000),
      },
    });
    const page = new URL(
      '/assistant/connect',
      getOptionalEnv('FRONTEND_URL', 'http://localhost:3001'),
    );
    const complete = new URL(page);
    complete.searchParams.set('code', userCode);
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: page.toString(),
      verification_uri_complete: complete.toString(),
      expires_in: DEVICE_CODE_SECONDS,
      interval: POLL_SECONDS,
    };
  }

  /** What the person is asked to approve, while the code is still waiting. */
  async describeDevice(userCode: string): Promise<{ clientName: string; expiresAt: Date }> {
    const code = await this.prisma.aiDeviceCode.findUnique({
      where: { userCode: userCode.toUpperCase() },
    });
    if (!code || code.approved !== null || code.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('No such code, or it expired or was already answered');
    }
    return { clientName: code.clientName, expiresAt: code.expiresAt };
  }

  async answerDevice(userCode: string, userId: string, approved: boolean): Promise<void> {
    const answered = await this.prisma.aiDeviceCode.updateMany({
      where: { userCode: userCode.toUpperCase(), approved: null, expiresAt: { gt: new Date() } },
      data: { approved, userId },
    });
    if (answered.count !== 1) {
      throw new NotFoundException('No such code, or it expired or was already answered');
    }
  }

  private async issue(userId: string, clientName: string): Promise<AiTokenDto> {
    const access = token('at');
    const refresh = token('rt');
    await this.prisma.aiGrant.create({
      data: {
        userId,
        clientName,
        accessTokenHash: hash(access),
        accessExpiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000),
        refreshTokenHash: hash(refresh),
      },
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_SECONDS,
    };
  }

  /** The device code the assistant waits on, swapped for tokens once the person approved it. */
  async exchangeDevice(deviceCode: string): Promise<AiTokenDto> {
    const code = await this.prisma.aiDeviceCode.findUnique({
      where: { deviceCodeHash: hash(deviceCode) },
    });
    if (!code || code.expiresAt.getTime() <= Date.now()) {
      throw new AiTokenError('expired_token', 'The code expired: ask for a new one');
    }
    if (code.approved === false) {
      await this.prisma.aiDeviceCode.delete({ where: { id: code.id } });
      throw new AiTokenError('access_denied', 'The owner refused this connection');
    }
    if (code.approved === null || !code.userId) {
      const tooSoon =
        code.lastPolledAt && Date.now() - code.lastPolledAt.getTime() < POLL_SECONDS * 1000;
      await this.prisma.aiDeviceCode.update({
        where: { id: code.id },
        data: { lastPolledAt: new Date() },
      });
      throw tooSoon
        ? new AiTokenError('slow_down', `Ask at most every ${String(POLL_SECONDS)} seconds`)
        : new AiTokenError('authorization_pending', 'Waiting for the owner to enter the code');
    }
    // Deleted first, so two polls at once cannot both turn one approval into two grants.
    const consumed = await this.prisma.aiDeviceCode.deleteMany({ where: { id: code.id } });
    if (consumed.count !== 1) {
      throw new AiTokenError('expired_token', 'The code was already used');
    }
    return this.issue(code.userId, code.clientName);
  }

  /** A refresh token swapped for new tokens; the old one stops working. */
  async refresh(refreshToken: string): Promise<AiTokenDto> {
    const access = token('at');
    const refresh = token('rt');
    const rotated = await this.prisma.aiGrant.updateMany({
      where: { refreshTokenHash: hash(refreshToken), revokedAt: null },
      data: {
        accessTokenHash: hash(access),
        accessExpiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000),
        refreshTokenHash: hash(refresh),
      },
    });
    if (rotated.count !== 1) {
      throw new AiTokenError(
        'invalid_grant',
        'This connection was revoked or the token already used',
      );
    }
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_SECONDS,
    };
  }

  // ---- grants -------------------------------------------------------------------------------

  async listGrants(userId: string): Promise<AiGrantDto[]> {
    const grants = await this.prisma.aiGrant.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return grants.map(grantOf);
  }

  /** One call cuts the assistant off everywhere. */
  async revokeGrant(userId: string, grantId: string): Promise<void> {
    const revoked = await this.prisma.aiGrant.updateMany({
      where: { id: grantId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new NotFoundException('No such connection');
    }
  }

  // ---- what a request reaches ----------------------------------------------------------------

  private async grantOf(authorization: string | undefined): Promise<AiGrant> {
    const access = authorization?.match(ACCESS)?.[1];
    const grant = access
      ? await this.prisma.aiGrant.findUnique({ where: { accessTokenHash: hash(access) } })
      : null;
    if (!grant || grant.revokedAt || grant.accessExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }
    if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
      void this.prisma.aiGrant
        .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return grant;
  }

  private ownedBy(userId: string, projectHint?: string): Prisma.ProjectWhereInput {
    if (projectHint !== undefined && projectHint !== '' && !isUUID(projectHint)) {
      throw new UnauthorizedException('This connection does not reach that project');
    }
    return { userId, ...(projectHint ? { id: projectHint.toLowerCase() } : {}) };
  }

  /**
   * The project a request is about: the one `X-Naucto-Project` names, or the only one the account
   * owns. With several and none named, the server will not guess.
   */
  async connection(
    authorization?: string,
    projectHint?: string,
  ): Promise<AiConnection & AiConnectionDto> {
    const grant = await this.grantOf(authorization);
    const reachable = await this.prisma.project.findMany({
      where: this.ownedBy(grant.userId, projectHint),
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 2,
    });
    const [project] = reachable;
    if (!project) {
      throw new UnauthorizedException(
        projectHint
          ? 'This connection does not reach that project'
          : 'This account owns no project',
      );
    }
    if (reachable.length > 1) {
      throw new ConflictException(
        'This connection reaches several projects: send X-Naucto-Project',
      );
    }
    return {
      projectId: project.id,
      userId: grant.userId,
      name: project.name,
      expiresAt: grant.accessExpiresAt,
    };
  }

  /** Every project the connection reaches, whatever project the request names. */
  async reachable(authorization?: string): Promise<AiReachableProjectDto[]> {
    const grant = await this.grantOf(authorization);
    const projects = await this.prisma.project.findMany({
      where: this.ownedBy(grant.userId),
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
