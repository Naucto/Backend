import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AiWorkspace } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { randomUUID } from "node:crypto";
import { aiContext, Game } from "@naucto/engine/headless";
import { AiService } from "./ai.service";
import { commitSnapshots } from "./ai-commit";
import { Choice, decodeSave, differences, encodeSave, mergeSave, overlaySave, reviewSave, saveHash, saveUnits } from "./ai-save";
import { WorkspaceSaveResponseDto, WorkspaceComparisonDto, WorkspaceMergeResponseDto, WorkspaceReviewResponseDto, WorkspaceConfirmedDto, WorkspaceStoredReviewDto } from "./ai-workspace-response.dto";
import { WorkspaceReviewDto, WorkspaceSaveDto } from "./ai-workspace.dto";

@Injectable()
export class AiWorkspaceService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService) {}

  async latest(projectId: number): Promise<string> {
    const bytes = await this.ai.newestStoredSave(projectId);
    if (!bytes) throw new ConflictException("No saved project is available");
    const snapshot = bytes.toString("base64"), doc = decodeSave(snapshot);
    doc.destroy();
    return snapshot;
  }
  async get(projectId: number): Promise<AiWorkspace> {
    const existing = await this.prisma.aiWorkspace.findUnique({ where: { projectId } });
    if (existing) return existing;
    const snapshot = await this.latest(projectId);
    return this.prisma.aiWorkspace.upsert({ where: { projectId }, create: { projectId, baseSnapshot: snapshot, snapshot }, update: {} });
  }
  private check(row: AiWorkspace, revision: number): void {
    if (row.revision !== revision) throw new ConflictException("AI save changed; read it again");
    if (row.pendingReviewId) throw new ConflictException("Human review is awaiting save confirmation; confirm or cancel it first");
  }
  async read(projectId: number, source: "draft" | "base" | "latest" = "draft"): Promise<WorkspaceSaveResponseDto> {
    const row = await this.get(projectId);
    const snapshot = source === "latest" ? await this.latest(projectId) : source === "base" ? row.baseSnapshot : row.snapshot;
    const doc = decodeSave(snapshot);
    try { return { revision: row.revision, pendingReviewId: row.pendingReviewId, source, hash: saveHash(saveUnits(snapshot)), snapshot, content: aiContext(new Game(doc)), updatedAt: row.updatedAt }; }
    finally { doc.destroy(); }
  }
  private async replace(row: AiWorkspace, snapshot: string, baseSnapshot = row.baseSnapshot): Promise<WorkspaceSaveResponseDto> {
    const updated = await this.prisma.aiWorkspace.updateMany({ where: { projectId: row.projectId, revision: row.revision, pendingReviewId: null }, data: { snapshot, baseSnapshot, revision: { increment: 1 } } });
    if (updated.count !== 1) throw new ConflictException("AI save changed; read it again");
    return this.read(row.projectId);
  }
  async save(projectId: number, dto: WorkspaceSaveDto): Promise<WorkspaceSaveResponseDto> {
    const row = await this.get(projectId); this.check(row, dto.revision);
    if ((dto.snapshot !== undefined) === (dto.operations !== undefined)) throw new BadRequestException("Supply exactly one of snapshot or operations");
    let snapshot: string;
    if (dto.snapshot !== undefined) {
      // Rebuild only game content; a raw client save cannot replace human locks or forge receipts.
      const old = saveUnits(row.snapshot), wanted = saveUnits(dto.snapshot);
      snapshot = overlaySave(row.snapshot, Object.fromEntries([...new Set([...Object.keys(old), ...Object.keys(wanted)])].map(id => [id, wanted[id] ?? null])));
    } else {
      const marker = randomUUID();
      const changed = commitSnapshots([row.snapshot], dto.operations, marker);
      const doc = decodeSave(changed.result);
      try { doc.getMap("ai.applied").delete(marker); snapshot = encodeSave(doc); } finally { doc.destroy(); }
    }
    // The same bounds and engine reader are used on every write, not just on raw imports.
    const doc = decodeSave(snapshot); doc.destroy();
    return this.replace(row, snapshot);
  }
  async compare(projectId: number, current?: string): Promise<WorkspaceComparisonDto> {
    const row = await this.get(projectId), latest = current ?? await this.latest(projectId);
    return { revision: row.revision, pendingReviewId: row.pendingReviewId, latestHash: saveHash(saveUnits(latest)), changes: differences(row.baseSnapshot, row.snapshot, latest) };
  }
  async merge(projectId: number, revision: number, latestHash: string, resolutions: Record<string, Choice> = {}): Promise<WorkspaceMergeResponseDto> {
    const row = await this.get(projectId); this.check(row, revision);
    const latest = await this.latest(projectId);
    if (saveHash(saveUnits(latest)) !== latestHash) throw new ConflictException("User save changed; compare again before merging");
    const merged = mergeSave(row.baseSnapshot, row.snapshot, latest, resolutions);
    if (merged.conflicts.length) return { revision, merged: false, conflicts: merged.conflicts };
    const save = await this.replace(row, merged.snapshot, latest);
    return { revision: save.revision, save, merged: true, conflicts: [] };
  }
  private assertLocks(current: string, result: string): void {
    const a = decodeSave(current), b = decodeSave(result);
    try {
      const before = aiContext(new Game(a)), after = aiContext(new Game(b));
      for (const raw of a.getMap("ai.locks").values()) {
        if (!raw || typeof raw !== "object") continue;
        const lock = raw as { target?: unknown; resourceId?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown };
        if (![lock.x, lock.y, lock.width, lock.height].every(v => typeof v === "number" && Number.isInteger(v) && v >= 0)) throw new ConflictException("Malformed protected region");
        const key = lock.target === "sheet" ? "sheets" : "maps";
        type Resource = { id: string; width: number; height: number; pixels?: string; tiles?: number[] };
        const left = (before[key] as Resource[]).find(r => r.id === lock.resourceId), right = (after[key] as Resource[]).find(r => r.id === lock.resourceId);
        if (!left || !right || left.width !== right.width || left.height !== right.height) throw new ConflictException("A protected resource was removed or resized");
        for (let y = Number(lock.y); y < Math.min(left.height, Number(lock.y) + Number(lock.height)); y++) for (let x = Number(lock.x); x < Math.min(left.width, Number(lock.x) + Number(lock.width)); x++) {
          if (x >= left.width || y >= left.height) continue;
          const i = y * left.width + x;
          if ((left.pixels ?? left.tiles)?.[i] !== (right.pixels ?? right.tiles)?.[i]) throw new ConflictException("Changes touch a protected region");
        }
      }
    } finally { a.destroy(); b.destroy(); }
  }
  async prepare(projectId: number, userId: number, dto: WorkspaceReviewDto): Promise<WorkspaceReviewResponseDto> {
    await this.ai.authorize(projectId, userId);
    const row = await this.get(projectId); this.check(row, dto.revision);
    if (saveHash(saveUnits(dto.snapshot)) !== dto.currentHash) throw new ConflictException("Editor snapshot changed; preview again");
    if (!dto.accepted.length && !dto.rejected.length) throw new BadRequestException("Choose at least one change");
    const review = reviewSave(row.baseSnapshot, row.snapshot, dto.snapshot, dto.accepted, dto.rejected, dto.resolutions ?? {});
    this.assertLocks(dto.snapshot, review.result);
    const id = randomUUID(), doc = decodeSave(review.result);
    let result: string;
    try { doc.getMap("ai.applied").set(id, { categories: review.categories }); result = encodeSave(doc); } finally { doc.destroy(); }
    const bounded = decodeSave(result); bounded.destroy();
    return this.prisma.$transaction(async tx => {
      const claimed = await tx.aiWorkspace.updateMany({ where: { projectId, revision: row.revision, pendingReviewId: null }, data: { pendingReviewId: id, revision: { increment: 1 } } });
      if (claimed.count !== 1) throw new ConflictException("AI save changed; preview again");
      await tx.aiSaveReview.create({ data: { id, projectId, userId, workspaceRevision: row.revision + 1, resultSnapshot: result, nextBaseSnapshot: review.nextBase, nextDraftSnapshot: review.remaining, categories: review.categories } });
      return { reviewId: id, revision: row.revision + 1, snapshot: result, requiresSaveConfirmation: true };
    });
  }
  async readReview(projectId: number, userId: number, id: string): Promise<WorkspaceStoredReviewDto> {
    await this.ai.authorize(projectId, userId);
    const review = await this.prisma.aiSaveReview.findFirst({ where: { id, projectId } });
    if (!review) throw new NotFoundException("Review unavailable");
    return { reviewId: review.id, status: review.status, revision: review.workspaceRevision, snapshot: review.resultSnapshot, requiresSaveConfirmation: review.status === "PREPARED" };
  }
  async confirm(projectId: number, userId: number, id: string): Promise<WorkspaceConfirmedDto> {
    await this.ai.authorize(projectId, userId);
    const review = await this.prisma.aiSaveReview.findFirst({ where: { id, projectId } });
    if (!review) throw new NotFoundException("Review unavailable");
    if (review.status === "CONFIRMED") return { confirmed: true, ...await this.read(projectId) };
    if (review.status !== "PREPARED") throw new ConflictException("Review is no longer pending");
    const latest = await this.latest(projectId), doc = decodeSave(latest);
    try { if (!doc.getMap("ai.applied").has(id)) throw new ConflictException("Save the reviewed document through the normal project save before confirming"); }
    finally { doc.destroy(); }
    // Keep intervening edits. Unreviewed conflicts retain their original base for the next merge.
    const rebased = mergeSave(review.resultSnapshot, review.nextDraftSnapshot, latest);
    const nextDraft = rebased.conflicts.length ? review.nextDraftSnapshot : rebased.snapshot;
    const nextBase = rebased.conflicts.length ? review.nextBaseSnapshot : overlaySave(latest, Object.fromEntries(differences(review.resultSnapshot, review.nextBaseSnapshot, review.resultSnapshot).map(d => [d.id, saveUnits(review.nextBaseSnapshot)[d.id] ?? null])));
    await this.prisma.$transaction(async tx => {
      const changed = await tx.aiWorkspace.updateMany({ where: { projectId, revision: review.workspaceRevision, pendingReviewId: id }, data: { snapshot: nextDraft, baseSnapshot: nextBase, pendingReviewId: null, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("Review already settled or workspace changed");
      await tx.aiSaveReview.update({ where: { id }, data: { status: "CONFIRMED" } });
      for (const category of review.categories) await tx.project.updateMany({ where: { id: projectId, NOT: { aiCategories: { has: category } } }, data: { aiCategories: { push: category } } });
    });
    return { confirmed: true, ...await this.read(projectId) };
  }
  async cancel(projectId: number, userId: number, id: string): Promise<{ cancelled: boolean }> {
    await this.ai.authorize(projectId, userId);
    const latest = decodeSave(await this.latest(projectId));
    try { if (latest.getMap("ai.applied").has(id)) throw new ConflictException("Review was saved; confirm it instead of cancelling"); }
    finally { latest.destroy(); }
    await this.prisma.$transaction(async tx => {
      const changed = await tx.aiWorkspace.updateMany({ where: { projectId, pendingReviewId: id }, data: { pendingReviewId: null, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("Review is not pending");
      await tx.aiSaveReview.updateMany({ where: { id, projectId, status: "PREPARED" }, data: { status: "CANCELLED" } });
    });
    return { cancelled: true };
  }
}
