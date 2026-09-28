import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Prisma, AiConnection, AiContext, AiProposal } from "@prisma/client";
import { AiConnectionResponseDto, AiMcpProjectDto, AiProposalDto, AiReviewDto } from "./ai.dto";
import { NON_INVERTIBLE_KINDS, OPERATION_KINDS } from "./ai-commit";

export interface AiKeyResponse { id: string; name: string; token: string; expiresAt: Date | null; createdAt: Date; projects: { projectId: number; name: string }[] }
export interface AiKeySummary { id: string; name: string; expiresAt: Date | null; createdAt: Date; lastUsedAt: Date | null; projects: { projectId: number; name: string }[] }
/** What a never-expiring key reports, so callers that read `expiresAt` keep working. */
const FAR_FUTURE = new Date(8640000000000000);

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(projectId: number, userId: number): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, OR: [{ userId, creator: { deletedAt: null } }, { collaborators: { some: { id: userId, deletedAt: null } } }] },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("Project unavailable");
  }

  async connect(projectId: number, userId: number): Promise<AiConnectionResponseDto> {
    await this.authorize(projectId, userId);
    const token = `naucto_ai_${randomBytes(32).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    // Rotate rather than accumulate live credentials for the same user/project.
    await this.prisma.$transaction([
      this.prisma.aiConnection.deleteMany({ where: { projectId, userId } }),
      this.prisma.aiConnection.create({ data: { projectId, userId, tokenHash: hash(token), expiresAt } })
    ]);
    return { token, expiresAt };
  }

  async revoke(projectId: number, userId: number): Promise<void> {
    await this.authorize(projectId, userId);
    await this.prisma.aiConnection.deleteMany({ where: { projectId, userId } });
    await this.prisma.aiContext.deleteMany({ where: { projectId, userId } });
  }

  /**
   * Creates a long-lived assistant credential. `expiresInDays` null (the default) never expires:
   * the user asked for a key they set up once, and a rotation is their call, not a countdown.
   */
  async createKey(userId: number, name: string, expiresInDays?: number | null): Promise<AiKeyResponse> {
    if (name.length < 1 || name.length > 60) throw new BadRequestException("Invalid key name");
    if (expiresInDays !== undefined && expiresInDays !== null && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650)) {
      throw new BadRequestException("Invalid expiry");
    }
    const token = `naucto_k_${randomBytes(32).toString("hex")}`;
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
    // A key list is not a place to keep things nobody will revoke.
    const live = await this.prisma.aiKey.count({ where: { userId, revokedAt: null } });
    if (live >= 20) throw new BadRequestException("Too many keys; revoke one you no longer use");
    const key = await this.prisma.aiKey.create({ data: { tokenHash: hash(token), userId, name, expiresAt } });
    return { id: key.id, name: key.name, token, expiresAt: key.expiresAt, createdAt: key.createdAt, projects: [] };
  }

  async listKeys(userId: number): Promise<AiKeySummary[]> {
    const keys = await this.prisma.aiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      include: { grants: { where: { revokedAt: null }, select: { projectId: true, project: { select: { name: true } } } } }
    });
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      projects: key.grants.map((g: { projectId: number; project: { name: string } }) => ({ projectId: g.projectId, name: g.project.name }))
    }));
  }

  /** Revoking the key kills it everywhere: a leaked key is the reason this has to be one call. */
  async revokeKey(userId: number, keyId: string): Promise<void> {
    const key = await this.prisma.aiKey.findFirst({ where: { id: keyId, userId } });
    if (!key) throw new NotFoundException("No such key");
    await this.prisma.aiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  }

  /** Lets a key reach one more project. Still a proposal-only credential, never an approver. */
  async grantKey(userId: number, keyId: string, projectId: number): Promise<void> {
    await this.authorize(projectId, userId);
    const key = await this.prisma.aiKey.findFirst({ where: { id: keyId, userId, revokedAt: null } });
    if (!key) throw new NotFoundException("No such key");
    await this.prisma.aiKeyGrant.upsert({
      where: { keyId_projectId: { keyId, projectId } },
      create: { keyId, projectId },
      update: { revokedAt: null }
    });
  }

  async revokeGrant(userId: number, keyId: string, projectId: number): Promise<void> {
    const key = await this.prisma.aiKey.findFirst({ where: { id: keyId, userId } });
    if (!key) throw new NotFoundException("No such key");
    await this.prisma.aiKeyGrant.updateMany({ where: { keyId, projectId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async keyConnection(token: string, projectHint?: string): Promise<AiConnection> {
    const key = await this.prisma.aiKey.findUnique({
      where: { tokenHash: hash(token) },
      include: { grants: { where: { revokedAt: null } } }
    });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) throw new UnauthorizedException();
    // Count only the projects this key can still use. A grant left behind by a collaborator the
    // owner has since been removed from would otherwise force the "several projects" answer when
    // only one is reachable, and hand access back if they are re-added.
    const usable = await this.prisma.aiKeyGrant.findMany({
      where: {
        keyId: key.id,
        revokedAt: null,
        project: { OR: [{ userId: key.userId, creator: { deletedAt: null } }, { collaborators: { some: { id: key.userId, deletedAt: null } } }] }
      },
      select: { projectId: true }
    });
    const granted = usable
      .map((g) => g.projectId)
      .filter((projectId) => projectHint === undefined || String(projectId) === projectHint);
    if (!granted.length) throw new UnauthorizedException("This key is not linked to that project");
    // Several linked projects and no hint: say so rather than picking one and reading the wrong game.
    if (granted.length > 1) throw new ConflictException("This key is linked to several projects: send X-Naucto-Project");
    const projectId = granted[0]!;
    await this.authorize(projectId, key.userId);
    // Every MCP call would otherwise write: the connection probe and the job polls alone are
    // dozens a minute, and "last used" only has to be roughly true.
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60000) {
      void this.prisma.aiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { projectId, userId: key.userId, expiresAt: key.expiresAt ?? FAR_FUTURE } as AiConnection;
  }

  /**
   * Resolves either credential: the 8-hour in-editor `naucto_ai_` token, or a long-lived
   * `naucto_k_` key. Both land on the same (project, user) pair, so every route below is unchanged.
   */
  async connection(authorization?: string, projectHint?: string): Promise<AiConnection> {
    const scoped = authorization?.match(/^Bearer (naucto_ai_[a-f0-9]{64})$/)?.[1];
    if (scoped) {
      const connection = await this.prisma.aiConnection.findUnique({ where: { tokenHash: hash(scoped) } });
      if (!connection || connection.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
      await this.authorize(connection.projectId, connection.userId);
      // A token names exactly one project, so a hint naming another one is a mistake worth
      // refusing: answering with the token's own project is how a client ends up reading the
      // wrong game without being told.
      if (projectHint !== undefined && projectHint !== String(connection.projectId)) throw new UnauthorizedException();
      return connection;
    }
    const key = authorization?.match(/^Bearer (naucto_k_[a-f0-9]{64})$/)?.[1];
    if (key) return this.keyConnection(key, projectHint);
    throw new UnauthorizedException();
  }

  async context(projectId: number, userId: number, content: Record<string, unknown>): Promise<{ hash: string }> {
    await this.authorize(projectId, userId);
    const encoded = JSON.stringify(content);
    if (Buffer.byteLength(encoded) > 1024 * 1024) throw new BadRequestException("Context exceeds 1 MiB");
    const digest = hash(encoded);
    await this.prisma.aiContext.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, hash: digest, content: json(content) },
      update: { hash: digest, content: json(content) }
    });
    return { hash: digest };
  }

  /**
   * The last state an editor shared, with how old it is.
   *
   * `fresh` is a floor of a minute, and it exists for one honest reason: the assistant works
   * whether or not anyone has the project open, and a project nobody has opened in a week still
   * has a perfectly good last-known state to work from. Age is the answer to "may I act on this",
   * not a wall — what an operation writes is checked against the real document when it is applied,
   * so a stale base is caught then rather than by refusing to read it here.
   */
  async storedContext(connection: AiConnection, maxAgeMs = Number.POSITIVE_INFINITY): Promise<{ context: AiContext; ageMs: number } | null> {
    const context = await this.prisma.aiContext.findUnique({ where: { projectId_userId: { projectId: connection.projectId, userId: connection.userId } } });
    if (!context) return null;
    const ageMs = Date.now() - context.updatedAt.getTime();
    if (ageMs > maxAgeMs) throw new ConflictException("Open the editor and share fresh context");
    return { context, ageMs };
  }

  async readContext(connection: AiConnection): Promise<AiContext> {
    const stored = await this.storedContext(connection, 60000);
    if (!stored) throw new ConflictException("Open the editor and share fresh context");
    return stored.context;
  }

  /**
   * Every project this credential may reach, so an assistant holding a key linked to several
   * games can find them instead of being told to guess an id. A key that reaches exactly one needs
   * no header; this is how anything wider knows what its options are.
   */
  async reachableProjects(authorization?: string, projectHint?: string): Promise<AiMcpProjectDto[]> {
    const describe = async (projectId: number, userId: number): Promise<AiMcpProjectDto> => {
      const [project, context, pending] = await Promise.all([
        this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
        this.prisma.aiContext.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { updatedAt: true } }),
        this.prisma.aiProposal.count({ where: { projectId, status: "PENDING" } }),
      ]);
      return {
        projectId,
        userId,
        name: project?.name ?? `Project ${String(projectId)}`,
        contextUpdatedAt: context?.updatedAt.toISOString() ?? null,
        contextAgeMs: context ? Date.now() - context.updatedAt.getTime() : null,
        pendingProposals: pending,
      };
    };
    const key = authorization?.match(/^Bearer (naucto_k_[a-f0-9]{64})$/)?.[1];
    if (!key) {
      // A project token names exactly one project, so there is nothing to enumerate.
      const connection = await this.connection(authorization, projectHint);
      return [await describe(connection.projectId, connection.userId)];
    }
    const found = await this.prisma.aiKey.findUnique({ where: { tokenHash: hash(key) }, include: { grants: { where: { revokedAt: null } } } });
    if (!found || found.revokedAt || (found.expiresAt && found.expiresAt.getTime() <= Date.now())) throw new UnauthorizedException();
    // Reachable means reachable: a grant to a project the owner has since lost is not an option.
    const usable = await this.prisma.aiKeyGrant.findMany({
      where: { keyId: found.id, revokedAt: null, project: { OR: [{ userId: found.userId, creator: { deletedAt: null } }, { collaborators: { some: { id: found.userId, deletedAt: null } } }] } },
      select: { projectId: true }
    });
    const hinted = projectHint === undefined ? usable : usable.filter((g) => String(g.projectId) === projectHint);
    if (!hinted.length) throw new UnauthorizedException("This key is not linked to that project");
    return Promise.all(hinted.map((g) => describe(g.projectId, found.userId)));
  }

  async propose(connection: AiConnection, dto: AiProposalDto): Promise<AiProposal> {
    const stored = await this.storedContext(connection);
    if (!stored) throw new ConflictException("No editor has shared this project yet");
    if (stored.context.hash !== dto.snapshotHash) throw new ConflictException("Context changed; read it again");
    if (Buffer.byteLength(JSON.stringify(dto)) > 1024 * 1024) throw new BadRequestException("Proposal exceeds 1 MiB");
    if (dto.operations.some(op => !OPERATION_KINDS.includes(String(op["kind"]) as typeof OPERATION_KINDS[number]))) throw new BadRequestException("Unsupported operation");
    const pending = await this.prisma.aiProposal.count({ where: { projectId: connection.projectId, status: "PENDING" } });
    if (pending >= 50) throw new ConflictException("Too many proposals await review; review or reject some first");
    const contentHash = hash(JSON.stringify({ title: dto.title, summary: dto.summary, snapshotHash: dto.snapshotHash, operations: dto.operations }));
    return this.prisma.aiProposal.create({ data: {
      projectId: connection.projectId, userId: connection.userId, title: dto.title,
      summary: dto.summary, snapshotHash: dto.snapshotHash, contentHash, operations: json(dto.operations),
      baseContextAgeMs: stored.ageMs
    } });
  }

  async list(projectId: number, userId: number): Promise<AiProposal[]> {
    await this.authorize(projectId, userId);
    return this.prisma.aiProposal.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  async review(projectId: number, userId: number, id: string, dto: AiReviewDto): Promise<void> {
    await this.authorize(projectId, userId);
    // Approving is applying: a separate "approved but not applied" state would let provenance and
    // the document disagree about what the person actually agreed to.
    if (dto.decision !== "REJECTED") throw new BadRequestException("Approve a proposal by applying it");
    const updated = await this.prisma.aiProposal.updateMany({
      where: { id, projectId, contentHash: dto.contentHash, status: "PENDING" },
      data: { status: dto.decision, reviewedBy: userId }
    });
    if (updated.count !== 1) throw new ConflictException("Proposal changed or already reviewed");
    // Approval alone never sets provenance. Only a committed application may do that.
  }

  async proposeRevert(projectId: number, userId: number, id: string): Promise<AiProposal> {
    await this.authorize(projectId, userId);
    const original = await this.prisma.aiProposal.findFirst({ where: { id, projectId, status: "APPLIED" } });
    if (!original) throw new ConflictException("Applied proposal unavailable");
    // The inverse was captured from the merged state at commit, so it names exactly what the
    // proposal replaced. It is a new proposal: reviewed, applied to the accepting editor's own
    // state, and refused if anyone has since edited what it would restore.
    const stored = original.inverse;
    if (!Array.isArray(stored) || !stored.length) throw new ConflictException("This change has no recorded inverse; restore it from version history");
    // A proposal that deleted a level or a sound cannot be undone as a whole, and reverting it
    // anyway would restore the parts it could while quietly leaving the rest — with nothing in the
    // revert's operations to say so. Version history has what is needed; a partial undo does not.
    const applied = Array.isArray(original.operations) ? (original.operations as Record<string, unknown>[]) : [];
    const lost = [...new Set(applied.map((operation) => String(operation["kind"])).filter((kind) => NON_INVERTIBLE_KINDS.has(kind)))];
    if (lost.length) throw new ConflictException(`This change removed something that cannot be put back automatically (${lost.join(", ")}); restore it from version history`);
    const operations = stored;
    const open = await this.prisma.aiProposal.findFirst({ where: { projectId, revertsId: id, status: "PENDING" } });
    if (open) return open;
    const title = `Revert: ${original.title}`.slice(0, 160);
    const summary = `Undo approved change ${id}. Anything edited since then causes a conflict instead of being overwritten.`;
    const snapshotHash = original.snapshotHash;
    return this.prisma.aiProposal.create({ data: {
      projectId, userId, title, summary, snapshotHash, operations: json(operations), revertsId: id,
      contentHash: hash(JSON.stringify({ title, summary, snapshotHash, operations }))
    } });
  }
}
