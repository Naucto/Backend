import { ApiProperty } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";

export class AiProposalResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: number;
  @ApiProperty() userId!: number;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty() snapshotHash!: string;
  @ApiProperty({ type: [Object] }) operations!: Prisma.JsonValue;
  @ApiProperty() contentHash!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: Number, nullable: true }) reviewedBy!: number | null;
  @ApiProperty({ type: String, nullable: true }) revertsId!: string | null;
  @ApiProperty({ type: [Object], nullable: true }) inverse!: Prisma.JsonValue | null;
  @ApiProperty({ description: "How old the shared state this proposal was written against was, in milliseconds. An assistant may work on a project nobody has open, so this is what says how far back it reaches." })
    baseContextAgeMs!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AiContextResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: number;
  @ApiProperty() userId!: number;
  @ApiProperty() hash!: string;
  @ApiProperty({ type: Object }) content!: Prisma.JsonValue;
  @ApiProperty() updatedAt!: Date;
}

export class AiJobResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: number;
  @ApiProperty() userId!: number;
  @ApiProperty() kind!: string;
  @ApiProperty({ enum: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] }) state!: string;
  @ApiProperty({ type: Object }) request!: Prisma.JsonValue;
  @ApiProperty({ type: Object, nullable: true }) result!: Prisma.JsonValue | null;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty() cancelRequested!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AiDeclarationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: number;
  @ApiProperty() userId!: number;
  @ApiProperty({ type: [String] }) categories!: string[];
  @ApiProperty() note!: string;
  @ApiProperty() createdAt!: Date;
}

export class AiAppliedSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiProperty() updatedAt!: Date;
}

export class AiProvenanceResponseDto {
  @ApiProperty({ type: [String] }) categories!: string[];
  @ApiProperty({ type: [AiDeclarationResponseDto] }) declarations!: AiDeclarationResponseDto[];
  @ApiProperty({ type: [AiAppliedSummaryDto] }) applied!: AiAppliedSummaryDto[];
}
