import { ApiProperty } from "@nestjs/swagger";
import { ModerationActionType, ModerationTargetType } from "@prisma/client";
import { PaginatedMetaDto } from "src/admin/dto/admin-pagination.dto";
import { AuditEntry } from "./audit.service";

export class AuditEntryDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ enum: ModerationTargetType })
  targetType!: ModerationTargetType;

  @ApiProperty()
  targetId!: number;

  @ApiProperty({ enum: ModerationActionType })
  action!: ModerationActionType;

  @ApiProperty({ nullable: true })
  actorId!: number | null;

  @ApiProperty({ nullable: true, description: "@username of the staff member" })
  actorLabel!: string | null;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({ nullable: true })
  reportId!: number | null;

  @ApiProperty()
  createdAt!: string;

  static from(entry: AuditEntry): AuditEntryDto {
    return {
      id: entry.id,
      targetType: entry.targetType,
      targetId: entry.targetId,
      action: entry.action,
      actorId: entry.actorId,
      actorLabel: entry.actor?.username ? `@${entry.actor.username}` : null,
      reason: entry.reason,
      reportId: entry.reportId,
      createdAt: entry.createdAt.toISOString()
    };
  }
}

export class AuditLogResponseDto {
  @ApiProperty({ type: [AuditEntryDto] })
  data!: AuditEntryDto[];

  @ApiProperty({ type: PaginatedMetaDto })
  meta!: PaginatedMetaDto;
}
