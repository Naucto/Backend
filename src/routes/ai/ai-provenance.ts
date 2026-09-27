import * as Y from "yjs";
import { PrismaService } from "@ourPrisma/prisma.service";

/** Receipt payloads are untrusted: derive categories from stored, human-approved operations. */
export async function recordSavedAiProvenance(prisma: PrismaService, projectId: number, content: Uint8Array): Promise<void> {
  const doc = new Y.Doc();
  let ids: string[];
  try {
    Y.applyUpdate(doc, content);
    ids = [...doc.getMap("ai.applied").keys()].filter(id => id.length <= 100);
  } catch {
    // Other legacy upload formats have no AI receipts.
    return;
  } finally {
    doc.destroy();
  }
  if (!ids.length) return;
  if (ids.length > 10000) throw new Error("Too many AI receipts");
  await prisma.$transaction(async tx => {
    const proposals = await tx.aiProposal.findMany({
      where: { projectId, id: { in: ids }, status: { in: ["APPROVED", "APPLIED"] } }
    });
    const categories = new Set<string>();
    for (const proposal of proposals) {
      if (!Array.isArray(proposal.operations)) continue;
      for (const operation of proposal.operations) {
        if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
        switch (operation["kind"]) {
        case "code": categories.add("CODE"); break;
        case "pixels": categories.add("SPRITES"); break;
        case "tiles":
        case "create_map":
        case "delete_map":
        case "resize_map": categories.add("MAPS"); break;
        case "net_permissions": categories.add("MULTIPLAYER"); break;
        // Catalog annotations describe artwork; they are not evidence the artwork was generated.
        case "catalog": break;
        case "sound":
        case "delete_sound":
          if (operation["category"] === "MUSIC" || operation["category"] === "SFX") categories.add(operation["category"]);
          break;
        }
      }
    }
    // Conditional append is atomic, including concurrent saves. There is no removal path.
    for (const category of [...categories].sort()) {
      await tx.project.updateMany({
        where: { id: projectId, NOT: { aiCategories: { has: category } } },
        data: { aiCategories: { push: category } }
      });
    }
    await tx.aiProposal.updateMany({
      where: { projectId, id: { in: proposals.map(p => p.id) }, status: "APPROVED" },
      data: { status: "APPLIED" }
    });
    const reverted = proposals.flatMap(proposal => proposal.revertsId ? [proposal.revertsId] : []);
    if (reverted.length) await tx.aiProposal.updateMany({
      where: { projectId, id: { in: reverted }, status: "APPLIED" },
      data: { status: "REVERTED" }
    });
  });
}
