import { timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AiConnection, AiDeclaration, AiJob, Prisma } from "@prisma/client";
import { AiService } from "./ai.service";

export const AI_CATEGORIES = ["CODE", "SPRITES", "MAPS", "MUSIC", "SFX", "MULTIPLAYER"] as const;
/** Only sprites are generated outside (PixelLab); music and sound are composed with the synth. */
const JOB_KINDS = ["sprite"];
/** A job nobody finished in this long was lost with the service that ran it. */
const LOST_MS = 10 * 60 * 1000;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class AiJobsService {
  private readonly perHour: number;
  private readonly secret: string | undefined;

  constructor(private readonly prisma: PrismaService, private readonly ai: AiService, config: ConfigService) {
    this.perHour = Number(config.get<string>("AI_JOBS_PER_PROJECT_HOUR") ?? 20);
    this.secret = config.get<string>("AI_SERVICE_SECRET") || undefined;
  }

  /**
   * Result submission is the shared service's alone. A project token is also held by the assistant
   * client, and a result it could write would carry a model name nobody ran.
   */
  assertService(header: string | undefined): void {
    if (!this.secret) throw new ServiceUnavailableException("AI_SERVICE_SECRET is not configured; generation is disabled");
    const given = Buffer.from(header ?? ""), wanted = Buffer.from(this.secret);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw new UnauthorizedException();
  }

  private async expireLost(projectId: number): Promise<void> {
    await this.prisma.aiJob.updateMany({
      where: { projectId, state: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: new Date(Date.now() - LOST_MS) } },
      data: { state: "FAILED", error: "The generation service stopped before finishing; no automatic paid retry was made" }
    });
  }

  async create(connection: AiConnection, kind: string, request: Record<string, unknown>): Promise<AiJob> {
    if (!JOB_KINDS.includes(kind)) throw new BadRequestException("Unknown generation kind");
    if (Buffer.byteLength(JSON.stringify(request)) > 16384) throw new BadRequestException("Generation request too large");
    await this.expireLost(connection.projectId);
    // The quota check and the insert are one serializable decision, so parallel requests cannot
    // each see room for one more.
    return this.prisma.$transaction(async tx => {
      const recent = await tx.aiJob.count({ where: { projectId: connection.projectId, createdAt: { gt: new Date(Date.now() - 3600000) } } });
      if (recent >= this.perHour) throw new ConflictException("Hourly generation quota reached for this project");
      return tx.aiJob.create({ data: { projectId: connection.projectId, userId: connection.userId, kind, request: json(request) } });
    }, { isolationLevel: "Serializable" });
  }

  async get(connection: AiConnection, id: string): Promise<AiJob> {
    const job = await this.prisma.aiJob.findFirst({ where: { id, projectId: connection.projectId } });
    if (!job) throw new NotFoundException("Generation job unavailable");
    return job;
  }

  /** QUEUED → RUNNING, unless someone cancelled it first. Returns whether to dispatch. */
  async claim(connection: AiConnection, id: string): Promise<boolean> {
    const updated = await this.prisma.aiJob.updateMany({ where: { id, projectId: connection.projectId, state: "QUEUED", cancelRequested: false }, data: { state: "RUNNING" } });
    if (!updated.count) await this.prisma.aiJob.updateMany({ where: { id, projectId: connection.projectId, state: "QUEUED" }, data: { state: "CANCELLED" } });
    return updated.count === 1;
  }

  async complete(connection: AiConnection, id: string, result: unknown, model: string): Promise<AiJob> {
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) throw new BadRequestException("Result too large");
    // A late answer to a cancelled job is discarded, never stored.
    await this.prisma.aiJob.updateMany({ where: { id, projectId: connection.projectId, state: "RUNNING", cancelRequested: true }, data: { state: "CANCELLED" } });
    await this.prisma.aiJob.updateMany({ where: { id, projectId: connection.projectId, state: "RUNNING" }, data: { state: "SUCCEEDED", result: json(result), model: model.slice(0, 200) } });
    return this.get(connection, id);
  }

  async fail(connection: AiConnection, id: string, error: string): Promise<void> {
    await this.prisma.aiJob.updateMany({
      where: { id, projectId: connection.projectId, state: { in: ["QUEUED", "RUNNING"] } },
      data: { state: "FAILED", error: error.slice(0, 300) }
    });
  }

  /** Pending work is never dispatched; running work is aborted and its late answer discarded. */
  async cancel(projectId: number, id: string): Promise<AiJob> {
    const job = await this.prisma.aiJob.findFirst({ where: { id, projectId } });
    if (!job) throw new NotFoundException("Generation job unavailable");
    if (job.state === "QUEUED") await this.prisma.aiJob.updateMany({ where: { id, state: "QUEUED" }, data: { state: "CANCELLED", cancelRequested: true } });
    else if (job.state === "RUNNING") await this.prisma.aiJob.updateMany({ where: { id, state: "RUNNING" }, data: { cancelRequested: true } });
    return this.prisma.aiJob.findUniqueOrThrow({ where: { id } });
  }

  async cancelAsEditor(projectId: number, userId: number, id: string): Promise<AiJob> {
    await this.ai.authorize(projectId, userId);
    return this.cancel(projectId, id);
  }

  async list(projectId: number, userId: number): Promise<AiJob[]> {
    await this.ai.authorize(projectId, userId);
    await this.expireLost(projectId);
    return this.prisma.aiJob.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  /**
   * Someone says AI tools were used outside Naucto's tracked workflow. Like applied changes, a
   * declaration only ever adds categories: the badge records history, not current content.
   */
  async declare(projectId: number, userId: number, categories: string[], note: string): Promise<AiDeclaration> {
    await this.ai.authorize(projectId, userId);
    const known = [...new Set(categories)].filter(value => AI_CATEGORIES.includes(value as typeof AI_CATEGORIES[number]));
    if (!known.length) throw new BadRequestException("Declare at least one category");
    return this.prisma.$transaction(async tx => {
      for (const category of known) {
        await tx.project.updateMany({ where: { id: projectId, NOT: { aiCategories: { has: category } } }, data: { aiCategories: { push: category } } });
      }
      return tx.aiDeclaration.create({ data: { projectId, userId, categories: known, note: note.slice(0, 1000) } });
    });
  }

  async provenance(projectId: number, userId: number): Promise<{ categories: string[]; declarations: AiDeclaration[]; applied: { id: string; title: string; status: string; updatedAt: Date }[] }> {
    await this.ai.authorize(projectId, userId);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { aiCategories: true } });
    const declarations = await this.prisma.aiDeclaration.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 50 });
    const applied = await this.prisma.aiProposal.findMany({
      where: { projectId, status: { in: ["APPLIED", "REVERTED"] } },
      select: { id: true, title: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" }, take: 100
    });
    return { categories: project.aiCategories, declarations, applied };
  }
}
