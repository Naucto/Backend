import { Readable } from 'node:stream';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AiWorkspace } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PROJECT_BLOB_MAX_BYTES } from '../project/content-size';
import { ProjectContentService } from '../project/project-content.service';
import { AiService } from './ai.service';
import { AiCategory, AiSaveDto, AiSaveSource, AiWorkspaceDto } from './dto/ai.dto';

/** A state as a write sends it. */
export interface AiSaveWrite {
  revision: number;
  snapshot: string;
  base?: string;
}

/** What a person kept and left: the document they now have, and the draft still to review. */
export interface AiReview {
  revision: number;
  base: string;
  draft: string;
  categories: AiCategory[];
}

const STALE = 'The AI save changed since it was read: read it again';

/**
 * The assistant's isolated copy of a project. The server only keeps it and hands it out: what a
 * state holds is read and written by the engine, in the MCP and in the editor, so a document is
 * never interpreted here and a stale CRDT history is never merged into the user's.
 *
 * The assistant writes its draft; a person sets it against the open document in the editor's diff
 * mode, keeps changes one at a time and writes the result through the ordinary editing session.
 * The review then hands back the document as it now stands as the new base, and what was left
 * pending as the new draft, so a change is offered again only until it is decided.
 */
@Injectable()
export class AiWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly content: ProjectContentService,
  ) {}

  private decode(snapshot: string): Buffer {
    const bytes = Buffer.from(snapshot, 'base64');
    if (bytes.length === 0 || bytes.length > PROJECT_BLOB_MAX_BYTES) {
      throw new BadRequestException(
        `A save is a non-empty state of ${PROJECT_BLOB_MAX_BYTES} bytes at most`,
      );
    }
    return bytes;
  }

  /** The newest user save, or null for a project never saved. */
  private async latest(projectId: string): Promise<Buffer | null> {
    const file = await this.content.fetchLastVersion(projectId);
    const chunks: Buffer[] = [];
    for await (const chunk of file.body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const bytes = Buffer.concat(chunks);
    return bytes.length ? bytes : null;
  }

  /** The workspace, made from the latest save the first time the assistant opens it. */
  private async open(projectId: string): Promise<AiWorkspace> {
    const held = await this.prisma.aiWorkspace.findUnique({ where: { projectId } });
    if (held) {
      return held;
    }
    const latest = await this.latest(projectId);
    if (!latest) {
      throw new ConflictException('This project has never been saved: open it once in the editor');
    }
    const bytes = new Uint8Array(latest);
    return this.prisma.aiWorkspace.upsert({
      where: { projectId },
      create: { projectId, base: bytes, draft: bytes },
      update: {},
    });
  }

  /** What the editor sets against the open document. Nothing is made for a person who only looks. */
  async forEditor(projectId: string, userId: string): Promise<AiWorkspaceDto> {
    await this.ai.authorize(projectId, userId);
    const held = await this.prisma.aiWorkspace.findUnique({ where: { projectId } });
    return {
      revision: held?.revision ?? 0,
      draft: held ? Buffer.from(held.draft).toString('base64') : null,
      base: held ? Buffer.from(held.base).toString('base64') : null,
      updatedAt: held?.updatedAt ?? null,
    };
  }

  /**
   * A review the editor made: `base` is the document once the kept changes are in it, `draft` the
   * same with the changes still waiting. What was refused is in neither, so it is not offered
   * again. Its categories join the game's for good.
   */
  async review(projectId: string, userId: string, review: AiReview): Promise<AiWorkspaceDto> {
    await this.ai.authorize(projectId, userId);
    const base = new Uint8Array(this.decode(review.base));
    const draft = new Uint8Array(this.decode(review.draft));
    await this.prisma.$transaction(async (tx) => {
      const written = await tx.aiWorkspace.updateMany({
        where: { projectId, revision: review.revision },
        data: { base, draft, revision: { increment: 1 } },
      });
      if (written.count !== 1) {
        throw new ConflictException(STALE);
      }
      for (const category of review.categories) {
        await tx.project.updateMany({
          where: { id: projectId, NOT: { aiCategories: { has: category } } },
          data: { aiCategories: { push: category } },
        });
      }
    });
    return this.forEditor(projectId, userId);
  }

  async read(projectId: string, source: AiSaveSource = 'draft'): Promise<AiSaveDto> {
    const held = await this.open(projectId);
    let bytes: Uint8Array;
    if (source === 'latest') {
      bytes = (await this.latest(projectId)) ?? held.base;
    } else {
      bytes = source === 'base' ? held.base : held.draft;
    }
    return {
      source,
      revision: held.revision,
      snapshot: Buffer.from(bytes).toString('base64'),
      updatedAt: held.updatedAt,
    };
  }

  /**
   * The assistant's write: its draft, and a new base where it took a user save in. Never the
   * user's project, which only a person changes, in the editor.
   */
  async write(projectId: string, write: AiSaveWrite): Promise<AiSaveDto> {
    await this.open(projectId);
    const draft = new Uint8Array(this.decode(write.snapshot));
    const base = write.base === undefined ? undefined : new Uint8Array(this.decode(write.base));
    const written = await this.prisma.aiWorkspace.updateMany({
      where: { projectId, revision: write.revision },
      data: { draft, ...(base ? { base } : {}), revision: { increment: 1 } },
    });
    if (written.count !== 1) {
      throw new ConflictException(STALE);
    }
    return this.read(projectId);
  }
}
