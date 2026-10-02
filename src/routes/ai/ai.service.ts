import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Prisma, AiProposal } from "@prisma/client";
import { Readable } from "stream";
import { S3Service } from "@s3/s3.service";
import { AiMcpProjectDto, AiProposalDto, AiReviewDto } from "./ai.dto";
import { buildContext } from "./ai-context";
import { NON_INVERTIBLE_KINDS, OPERATION_KINDS } from "./ai-commit";
import { hasReceipt } from "./ai-receipt";

export interface AiKeyResponse { id: string; name: string; token: string; expiresAt: Date | null; createdAt: Date }
export interface AiKeySummary { id: string; name: string; expiresAt: Date | null; createdAt: Date; lastUsedAt: Date | null }
/** Who is asking and which project they are working on: all a route below needs from a credential. */
export interface AiMcpConnection { projectId: number; userId: number; expiresAt: Date }
/** The project as last saved, in the shape the MCP reads, and how old that save is. */
export interface AiStoredContext { hash: string; content: Record<string, unknown>; updatedAt: Date; ageMs: number }
/**
 * The oldest a save can be reported as: the column is a 32-bit integer, and a project nobody has opened
 * in a month is 2.6 billion milliseconds old — past it, and now an ordinary thing for a key to meet.
 */
const MAX_AGE_MS = 2_147_483_647;
/** What a never-expiring key reports, so callers that read `expiresAt` keep working. */
const FAR_FUTURE = new Date(8640000000000000);

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService, private readonly s3: S3Service) {}

  /**
   * The bytes of the most recent autosave slot, or null when the project has never been saved.
   *
   * Read to answer "does storage hold this yet?" — a question a row cannot answer on its own, since
   * whether a change reached storage depends on whether a save carrying it has happened, not on
   * anything recorded at the moment it was claimed.
   */
  async newestStoredSave(projectId: number): Promise<Buffer | null> {
    const slots = await this.s3.listObjects({ prefix: `save/${projectId}/` });
    // By last-modified, not by name: a slot is named for the moment it opened, so the newest name is
    // the newest slot only while windows do not overlap.
    const newest = slots
      .filter((o) => o.Key)
      .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))[0];
    if (!newest?.Key) return null;
    try {
      const { body } = await this.s3.downloadFile({ key: newest.Key });
      const chunks: Buffer[] = [];
      for await (const chunk of body as Readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      return Buffer.concat(chunks);
    } catch {
      // Unreadable is not evidence that the change is absent, and the caller's question is whether
      // it is absent. Saying "cannot tell" is not something this can express, so it refuses to
      // re-apply instead: a change that is stored but unreadable is far better off than one applied
      // twice.
      return null;
    }
  }

  async authorize(projectId: number, userId: number): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, OR: [{ userId, creator: { deletedAt: null } }, { collaborators: { some: { id: userId, deletedAt: null } } }] },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("Project unavailable");
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
    return { id: key.id, name: key.name, token, expiresAt: key.expiresAt, createdAt: key.createdAt };
  }

  async listKeys(userId: number): Promise<AiKeySummary[]> {
    const keys = await this.prisma.aiKey.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: "desc" } });
    return keys.map((key) => ({ id: key.id, name: key.name, expiresAt: key.expiresAt, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt }));
  }

  /** Revoking the key kills it everywhere: a leaked key is the reason this has to be one call. */
  async revokeKey(userId: number, keyId: string): Promise<void> {
    const key = await this.prisma.aiKey.findFirst({ where: { id: keyId, userId } });
    if (!key) throw new NotFoundException("No such key");
    await this.prisma.aiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  }

  /** The projects an account owns: what a key reaches, with no per-project linking. */
  private owned(userId: number): Prisma.ProjectWhereInput {
    return { userId, creator: { deletedAt: null } };
  }

  /**
   * Resolves an account key to the project a request is about.
   *
   * A key is the account's: it reaches every project the account owns, so there is nothing to link
   * and nothing a collaborator invite or a removal can leave dangling. When the account owns several
   * and the request names none, the Backend will not guess which one is meant.
   */
  async connection(authorization?: string, projectHint?: string): Promise<AiMcpConnection> {
    const token = authorization?.match(/^Bearer (naucto_k_[a-f0-9]{64})$/)?.[1];
    if (!token) throw new UnauthorizedException();
    const key = await this.prisma.aiKey.findUnique({ where: { tokenHash: hash(token) } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) throw new UnauthorizedException();
    const hinted = projectHint !== undefined && projectHint !== "";
    if (hinted && !/^\d{1,10}$/.test(projectHint)) throw new UnauthorizedException("This key does not reach that project");
    const reachable = await this.prisma.project.findMany({
      where: { ...this.owned(key.userId), ...(hinted ? { id: Number(projectHint) } : {}) },
      select: { id: true },
      take: 2,
      orderBy: { id: "asc" }
    });
    if (!reachable.length) throw new UnauthorizedException(hinted ? "This key does not reach that project" : "This account owns no project");
    // Several projects and no hint: say so rather than picking one and reading the wrong game.
    if (reachable.length > 1) throw new ConflictException("This key reaches several projects: send X-Naucto-Project");
    // Every MCP call would otherwise write: the connection probe and the job polls alone are
    // dozens a minute, and "last used" only has to be roughly true.
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60000) {
      void this.prisma.aiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { projectId: reachable[0]!.id, userId: key.userId, expiresAt: key.expiresAt ?? FAR_FUTURE };
  }

  /**
   * The project as last saved, in the shape the MCP reads, and how old that save is.
   *
   * Built from storage rather than from an editor, because the assistant works whether or not
   * anybody has the project open. Age is reported, not enforced: what an operation writes is checked
   * against the document of the person who accepts it, so a stale base is caught there, where there
   * is a human, and not here, where the only outcome would be an assistant that cannot start.
   */
  async storedContext(connection: { projectId: number }): Promise<AiStoredContext | null> {
    const saved = await this.newestSave(connection.projectId);
    if (!saved) return null;
    let content: Record<string, unknown>;
    try {
      content = buildContext(saved.bytes);
    } catch {
      throw new ConflictException("This project's saved state cannot be read; open it once in the editor");
    }
    return { content, hash: hash(JSON.stringify(content)), updatedAt: saved.at, ageMs: Date.now() - saved.at.getTime() };
  }

  /** The newest autosave slot with the moment it was written, or null for a project never saved. */
  private async newestSave(projectId: number): Promise<{ bytes: Buffer; at: Date } | null> {
    const slots = await this.s3.listObjects({ prefix: `save/${projectId}/` });
    const newest = slots.filter((o) => o.Key).sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))[0];
    if (!newest?.Key) return null;
    const { body } = await this.s3.downloadFile({ key: newest.Key });
    const chunks: Buffer[] = [];
    for await (const chunk of body as Readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    return { bytes: Buffer.concat(chunks), at: newest.LastModified ?? new Date() };
  }

  /** Every project this account's key reaches, with what is waiting in each. */
  async reachableProjects(authorization?: string, projectHint?: string): Promise<AiMcpProjectDto[]> {
    const token = authorization?.match(/^Bearer (naucto_k_[a-f0-9]{64})$/)?.[1];
    if (!token) throw new UnauthorizedException();
    const key = await this.prisma.aiKey.findUnique({ where: { tokenHash: hash(token) } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) throw new UnauthorizedException();
    const hinted = projectHint !== undefined && projectHint !== "";
    if (hinted && !/^\d{1,10}$/.test(projectHint)) throw new UnauthorizedException("This key does not reach that project");
    const projects = await this.prisma.project.findMany({
      where: { ...this.owned(key.userId), ...(hinted ? { id: Number(projectHint) } : {}) },
      select: { id: true, name: true },
      orderBy: { id: "asc" }
    });
    if (!projects.length) throw new UnauthorizedException(hinted ? "This key does not reach that project" : "This account owns no project");
    return Promise.all(projects.map(async (project) => {
      const [slots, pending] = await Promise.all([
        this.s3.listObjects({ prefix: `save/${project.id}/` }),
        this.prisma.aiProposal.count({ where: { projectId: project.id, status: "PENDING" } })
      ]);
      const at = slots.map((o) => o.LastModified?.getTime() ?? 0).sort((a, b) => b - a)[0];
      return {
        projectId: project.id,
        userId: key.userId,
        name: project.name,
        contextUpdatedAt: at ? new Date(at).toISOString() : null,
        contextAgeMs: at ? Date.now() - at : null,
        pendingProposals: pending
      };
    }));
  }

  async propose(connection: AiMcpConnection, dto: AiProposalDto): Promise<AiProposal> {
    const stored = await this.storedContext(connection);
    if (!stored) throw new ConflictException("This project has no saved state yet: open it once in the editor");
    if (stored.hash !== dto.snapshotHash) throw new ConflictException("Context changed; read it again");
    if (Buffer.byteLength(JSON.stringify(dto)) > 1024 * 1024) throw new BadRequestException("Proposal exceeds 1 MiB");
    if (dto.operations.some(op => !OPERATION_KINDS.includes(String(op["kind"]) as typeof OPERATION_KINDS[number]))) throw new BadRequestException("Unsupported operation");
    const pending = await this.prisma.aiProposal.count({ where: { projectId: connection.projectId, status: "PENDING" } });
    if (pending >= 50) throw new ConflictException("Too many proposals await review; review or reject some first");
    const contentHash = hash(JSON.stringify({ title: dto.title, summary: dto.summary, snapshotHash: dto.snapshotHash, operations: dto.operations }));
    return this.prisma.aiProposal.create({ data: {
      projectId: connection.projectId, userId: connection.userId, title: dto.title,
      summary: dto.summary, snapshotHash: dto.snapshotHash, contentHash, operations: json(dto.operations),
      baseContextAgeMs: Math.min(stored.ageMs, MAX_AGE_MS)
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
    // A change that was claimed but never stored cannot be reverted: there is nothing to take back
    // out, so the inverse's `before` will not match anything and the revert would fail later, in a
    // way that reads as a conflict with somebody's edit rather than as "this never happened". The
    // receipt is the evidence — it is in the document only if the change reached it.
    const held = (await this.newestStoredSave(projectId)) ?? null;
    if (original.storedAt === null && !hasReceipt(held ?? Buffer.alloc(0), id)) {
      throw new ConflictException("This change was applied but never saved, so there is nothing to revert. Apply it again instead.");
    }
    // The inverse was captured from the merged state at commit, so it names exactly what the
    // proposal replaced. It is a new proposal: reviewed, applied to the accepting editor's own
    // state, and refused if anyone has since edited what it would restore.
    const stored = original.inverse;
    if (!Array.isArray(stored) || !stored.length) throw new ConflictException("This change has no recorded inverse; restore it from version history");
    // A proposal that deleted a level or a sound cannot be undone as a whole, and reverting it
    // anyway would restore the parts it could while quietly leaving the rest — with nothing in the
    // revert's operations to say so. Version history has what is needed; a partial undo does not.
    // Not a list is refused rather than read as an empty one. Reading it as empty would say "nothing
    // here cannot be undone" about a row whose operations cannot be read at all, and the revert would
    // then restore what it could while saying nothing about the rest.
    if (!Array.isArray(original.operations)) throw new ConflictException("This change's record cannot be read; restore it from version history");
    const applied = (original.operations as unknown[]).filter((operation) => operation !== null && typeof operation === "object");
    const lost = [...new Set(applied.map((operation) => String((operation as Record<string, unknown>)["kind"])).filter((kind) => NON_INVERTIBLE_KINDS.has(kind)))];
    if (lost.length) throw new ConflictException(`This change removed something that cannot be put back automatically (${lost.join(", ")}); restore it from version history`);
    const operations = stored;
    const open = await this.prisma.aiProposal.findFirst({ where: { projectId, revertsId: id, status: "PENDING" } });
    if (open) return open;
    const title = `Revert: ${original.title}`.slice(0, 160);
    const summary = `Undo approved change ${id}. Anything edited since then causes a conflict instead of being overwritten.`;
    const snapshotHash = original.snapshotHash;
    return this.prisma.aiProposal.create({ data: {
      projectId, userId, title, summary, snapshotHash, operations: json(operations), revertsId: id,
      // A revert is written against the original's snapshot, so it reaches back just as far.
      // Defaulting to 0 would report a week-old base as current.
      baseContextAgeMs: original.baseContextAgeMs,
      contentHash: hash(JSON.stringify({ title, summary, snapshotHash, operations }))
    } });
  }
}
