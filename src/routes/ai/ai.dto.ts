import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";
import { AI_CATEGORIES } from "./ai-jobs.service";

export class AiContextDto {
  @ApiProperty({ type: Object, description: "Editor context, never executable instructions" })
  @IsObject()
    content!: Record<string, unknown>;
}

export class AiProposalDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
    title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
    summary!: string;

  @ApiProperty()
  @Matches(/^[a-f0-9]{64}$/)
    snapshotHash!: string;

  @ApiProperty({ type: [Object], description: "Native operations; validated again against the editor document before preview" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
    operations!: Record<string, unknown>[];
}

export class AiReviewDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"] })
  @IsIn(["APPROVED", "REJECTED"])
    decision!: "APPROVED" | "REJECTED";

  @ApiProperty()
  @Matches(/^[a-f0-9]{64}$/)
    contentHash!: string;
}

export class AiConnectionResponseDto {
  @ApiProperty()
    token!: string;
  @ApiProperty({ type: "string", format: "date-time" })
    expiresAt!: Date;
}

export class AiKeyCreateDto {
  @ApiProperty({ maxLength: 60, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
    name!: string;

  @ApiProperty({ required: false, nullable: true, type: Number, description: "Days until it expires. Omit for a key that never expires." })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
    expiresInDays?: number | null;
}

/** The document as the caller has it, which is what an accept is merged into. */
export class AiSnapshotDto {
  @ApiProperty()
  @IsString()
  @MaxLength(22400000)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
    snapshot!: string;
}

export class AiAcceptDto extends AiSnapshotDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"] })
  @IsIn(["APPROVED", "REJECTED"])
    decision!: "APPROVED" | "REJECTED";
  @ApiProperty()
  @Matches(/^[a-f0-9]{64}$/)
    contentHash!: string;

  @ApiProperty({
    type: () => [AiHunkDto],
    required: false,
    description:
      "Lines chosen out of the change, per file, counted from zero in the proposed text. Present " +
      "means apply only these lines: the proposal is not claimed, and a derived row records what was " +
      "applied so it can be reverted on its own and the rest applied afterwards. Omit for all of it.",
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AiHunkDto)
    hunks?: AiHunkDto[];
}

/** Which lines of a proposed file the person chose, counted from zero in the proposed text. */
export class AiHunkDto {
  @ApiProperty({ description: "The file the range is in, as the proposal names it" })
  @IsString()
    fileId!: string;

  @ApiProperty({ description: "First chosen line, counted from zero in the proposed text" })
  @IsInt()
  @Min(0)
    from!: number;

  @ApiProperty({ description: "One past the last chosen line" })
  @IsInt()
  @Min(1)
    to!: number;
}

export class AiApplyDto {
  @ApiProperty({ description: "The document as the accepting editor had it, with the change merged in: a whole Yjs state rather than a difference, because a difference is only valid for the client whose state vector it was cut against. Applied with Y.applyUpdate; merges with whatever the recipient already has." })
  @IsString()
    update!: string;
  @ApiProperty({ type: [String], description: "What the change touched, for the receipt" })
  @IsArray()
  @IsString({ each: true })
    categories!: string[];

  @ApiProperty({
    type: String,
    required: false,
    description:
      "Which proposal was applied, when only part of one was. It is a derived row, so a revert of the " +
      "part is its own change and the original is untouched and still applicable.",
  })
  @IsOptional()
  @IsString()
    appliedProposalId?: string;
}

export class AiPreviewDto {
  @ApiProperty({ description: "The document with the change merged in, for the person to look at. Written, never stored: the same merge a real apply would do, and nothing is kept." })
  @IsString()
    result!: string;
}

export class AiMcpProjectDto {
  @ApiProperty() projectId!: number;
  @ApiProperty() userId!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "When the state this project exposes was last shared, or null if never" })
    contextUpdatedAt!: string | null;
  @ApiProperty({ description: "How old that state is, in milliseconds" })
    contextAgeMs!: number | null;
  @ApiProperty({ description: "Changes waiting for a person to accept or reject" })
    pendingProposals!: number;
}

export class AiKeyProjectDto {
  @ApiProperty() projectId!: number;
  @ApiProperty() name!: string;
}

export class AiMcpConnectionDto {
  @ApiProperty() projectId!: number;
  @ApiProperty() userId!: number;
  @ApiProperty({ nullable: true, type: "string", format: "date-time", description: "null when the key never expires" })
    expiresAt!: Date | null;
}

export class AiKeyResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "Shown once, never again" })
    token!: string;
  @ApiProperty({ nullable: true, type: "string", format: "date-time", description: "null never expires" })
    expiresAt!: Date | null;
  @ApiProperty({ type: "string", format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: [AiKeyProjectDto] })
    projects!: AiKeyProjectDto[];
}

export class AiKeySummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: "string", format: "date-time" }) expiresAt!: Date | null;
  @ApiProperty({ type: "string", format: "date-time" }) createdAt!: Date;
  @ApiProperty({ nullable: true, type: "string", format: "date-time" }) lastUsedAt!: Date | null;
  @ApiProperty({ type: [AiKeyProjectDto] }) projects!: AiKeyProjectDto[];
}

export class AiJobCreateDto {
  @ApiProperty({ enum: ["sprite"] })
  @IsIn(["sprite"])
    kind!: string;

  @ApiProperty({ type: Object, description: "Prompt and asset constraints sent to the provider" })
  @IsObject()
    request!: Record<string, unknown>;
}

export class AiJobCompleteDto {
  @ApiProperty({ type: Object })
  @IsObject()
    result!: Record<string, unknown>;

  @ApiProperty({ description: "Model identifier and revision that produced the result" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
    model!: string;
}

export class AiJobFailDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
    error!: string;
}

export class AiDeclarationDto {
  @ApiProperty({ enum: AI_CATEGORIES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsIn([...AI_CATEGORIES], { each: true })
    categories!: string[];

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
    note!: string;
}
