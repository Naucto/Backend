import { timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AiDeclaration, AiJob, Prisma } from '@prisma/client';

import { getOptionalEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AiConnection, AiService } from './ai.service';
import { AiCategory, AiDeclarationDto, AiJobDto, AiProvenanceDto } from './dto/ai.dto';

/** Only sprites are generated outside (PixelLab); music and sound are composed with the synth. */
const JOB_KINDS = ['sprite'];
/** A job nobody finished in this long was lost with the service that ran it. */
const LOST_MS = 10 * 60 * 1000;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

const jobOf = (job: AiJob): AiJobDto => ({
  id: job.id,
  kind: job.kind,
  state: job.state,
  request: job.request,
  result: job.result,
  error: job.error,
  model: job.model,
  cancelRequested: job.cancelRequested,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const declarationOf = (declaration: AiDeclaration): AiDeclarationDto => ({
  id: declaration.id,
  categories: declaration.categories,
  note: declaration.note,
  createdAt: declaration.createdAt,
});

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Specialist generation jobs the MCP queues, and what a project says about the AI it used. A
 * result is stored by the generation service alone: the key is also held by the assistant, and a
 * result it could write would name a model nobody ran.
 */
@Injectable()
export class AiJobsService {
  private readonly perHour = getOptionalEnv('AI_JOBS_PER_PROJECT_HOUR', 20);
  private readonly secret = getOptionalEnv('AI_SERVICE_SECRET');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  assertService(header: string | undefined): void {
    if (!this.secret) {
      throw new ServiceUnavailableException('AI_SERVICE_SECRET is not set: generation is off');
    }
    const given = Buffer.from(header ?? '');
    const wanted = Buffer.from(this.secret);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new UnauthorizedException();
    }
  }

  private async expireLost(projectId: string): Promise<void> {
    await this.prisma.aiJob.updateMany({
      where: {
        projectId,
        state: { in: ['QUEUED', 'RUNNING'] },
        updatedAt: { lt: new Date(Date.now() - LOST_MS) },
      },
      data: { state: 'FAILED', error: 'The generation service stopped before finishing' },
    });
  }

  async create(
    connection: AiConnection,
    kind: string,
    request: Record<string, unknown>,
  ): Promise<AiJobDto> {
    if (!JOB_KINDS.includes(kind)) {
      throw new BadRequestException('Unknown generation kind');
    }
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES) {
      throw new BadRequestException('Generation request too large');
    }
    await this.expireLost(connection.projectId);
    // One serializable decision, so parallel requests cannot each see room for one more.
    const job = await this.prisma.$transaction(
      async (tx) => {
        const recent = await tx.aiJob.count({
          where: {
            projectId: connection.projectId,
            createdAt: { gt: new Date(Date.now() - 3_600_000) },
          },
        });
        if (recent >= this.perHour) {
          throw new ConflictException('Hourly generation quota reached for this project');
        }
        return tx.aiJob.create({
          data: {
            projectId: connection.projectId,
            userId: connection.userId,
            kind,
            request: json(request),
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return jobOf(job);
  }

  async get(projectId: string, id: string): Promise<AiJobDto> {
    const job = await this.prisma.aiJob.findFirst({ where: { id, projectId } });
    if (!job) {
      throw new NotFoundException('Generation job unavailable');
    }
    return jobOf(job);
  }

  /** QUEUED to RUNNING, unless someone cancelled it first; answers whether to run it. */
  async claim(projectId: string, id: string): Promise<boolean> {
    const started = await this.prisma.aiJob.updateMany({
      where: { id, projectId, state: 'QUEUED', cancelRequested: false },
      data: { state: 'RUNNING' },
    });
    if (started.count === 0) {
      await this.prisma.aiJob.updateMany({
        where: { id, projectId, state: 'QUEUED' },
        data: { state: 'CANCELLED' },
      });
    }
    return started.count === 1;
  }

  async complete(projectId: string, id: string, result: unknown, model: string): Promise<AiJobDto> {
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
      throw new BadRequestException('Result too large');
    }
    // A late answer to a cancelled job is dropped, never stored.
    await this.prisma.aiJob.updateMany({
      where: { id, projectId, state: 'RUNNING', cancelRequested: true },
      data: { state: 'CANCELLED' },
    });
    await this.prisma.aiJob.updateMany({
      where: { id, projectId, state: 'RUNNING' },
      data: { state: 'SUCCEEDED', result: json(result), model },
    });
    return this.get(projectId, id);
  }

  async fail(projectId: string, id: string, error: string): Promise<void> {
    await this.prisma.aiJob.updateMany({
      where: { id, projectId, state: { in: ['QUEUED', 'RUNNING'] } },
      data: { state: 'FAILED', error },
    });
  }

  /** Queued work is never run; running work is told to stop and its late answer dropped. */
  async cancel(projectId: string, id: string): Promise<AiJobDto> {
    const job = await this.get(projectId, id);
    if (job.state === 'QUEUED') {
      await this.prisma.aiJob.updateMany({
        where: { id, state: 'QUEUED' },
        data: { state: 'CANCELLED', cancelRequested: true },
      });
    } else if (job.state === 'RUNNING') {
      await this.prisma.aiJob.updateMany({
        where: { id, state: 'RUNNING' },
        data: { cancelRequested: true },
      });
    }
    return this.get(projectId, id);
  }

  async cancelAsEditor(projectId: string, userId: string, id: string): Promise<AiJobDto> {
    await this.ai.authorize(projectId, userId);
    return this.cancel(projectId, id);
  }

  async list(projectId: string, userId: string): Promise<AiJobDto[]> {
    await this.ai.authorize(projectId, userId);
    await this.expireLost(projectId);
    const jobs = await this.prisma.aiJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return jobs.map(jobOf);
  }

  /** AI used outside the tracked workflow. Like a kept change, it only ever adds categories. */
  async declare(
    projectId: string,
    userId: string,
    categories: AiCategory[],
    note: string,
  ): Promise<AiDeclarationDto> {
    await this.ai.authorize(projectId, userId);
    if (!categories.length) {
      throw new BadRequestException('Declare at least one category');
    }
    const declaration = await this.prisma.$transaction(async (tx) => {
      for (const category of categories) {
        await tx.project.updateMany({
          where: { id: projectId, NOT: { aiCategories: { has: category } } },
          data: { aiCategories: { push: category } },
        });
      }
      return tx.aiDeclaration.create({ data: { projectId, userId, categories, note } });
    });
    return declarationOf(declaration);
  }

  async provenance(projectId: string, userId: string): Promise<AiProvenanceDto> {
    await this.ai.authorize(projectId, userId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { aiCategories: true },
    });
    const declarations = await this.prisma.aiDeclaration.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      categories: project.aiCategories,
      declarations: declarations.map(declarationOf),
    };
  }
}
