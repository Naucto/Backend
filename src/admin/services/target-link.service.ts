import { Injectable } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";

export type TargetType = "USER" | "PROJECT" | "COMMENT" | "REPORT";

export type TargetInput = {
  id: number;
  type: TargetType | string;
};

export type TargetLink = {
  label: string;
  recordId: number;
  resource: TargetType;
};

function targetKey(type: string, id: number): string {
  return `${type}:${id}`;
}

function truncate(value: string, maxLength = 82): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function isTargetType(value: string): value is TargetType {
  return value === "USER" || value === "PROJECT" || value === "COMMENT" || value === "REPORT";
}

@Injectable()
export class TargetLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(targets: TargetInput[]): Promise<Map<string, TargetLink>> {
    const idsByType = new Map<TargetType, Set<number>>();

    for (const target of targets) {
      if (!isTargetType(target.type)) continue;
      const ids = idsByType.get(target.type) ?? new Set<number>();
      ids.add(target.id);
      idsByType.set(target.type, ids);
    }

    const [users, projects, comments, reports] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: Array.from(idsByType.get("USER") ?? []) } },
        select: { id: true, username: true, email: true }
      }),
      this.prisma.project.findMany({
        where: { id: { in: Array.from(idsByType.get("PROJECT") ?? []) } },
        select: { id: true, name: true, publishedName: true }
      }),
      this.prisma.comment.findMany({
        where: { id: { in: Array.from(idsByType.get("COMMENT") ?? []) } },
        select: {
          id: true,
          content: true,
          author: { select: { username: true } }
        }
      }),
      this.prisma.report.findMany({
        where: { id: { in: Array.from(idsByType.get("REPORT") ?? []) } },
        select: { id: true, reason: true, status: true }
      })
    ]);

    const links = new Map<string, TargetLink>();

    for (const user of users) {
      links.set(targetKey("USER", user.id), {
        label: user.username ? `@${user.username}` : user.email,
        recordId: user.id,
        resource: "USER"
      });
    }

    for (const project of projects) {
      links.set(targetKey("PROJECT", project.id), {
        label: project.publishedName || project.name,
        recordId: project.id,
        resource: "PROJECT"
      });
    }

    for (const comment of comments) {
      links.set(targetKey("COMMENT", comment.id), {
        label: `Comment #${comment.id} by @${comment.author.username}: ${truncate(comment.content)}`,
        recordId: comment.id,
        resource: "COMMENT"
      });
    }

    for (const report of reports) {
      links.set(targetKey("REPORT", report.id), {
        label: `Report #${report.id} · ${report.status} · ${truncate(report.reason, 48)}`,
        recordId: report.id,
        resource: "REPORT"
      });
    }

    return links;
  }

  async resolveSingle(type: string, id: number): Promise<TargetLink | null> {
    const map = await this.resolve([{ type, id }]);
    return map.get(targetKey(type, id)) ?? null;
  }
}
