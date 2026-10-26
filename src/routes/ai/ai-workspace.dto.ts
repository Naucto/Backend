import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";
import { AiSnapshotDto } from "./ai.dto";

export class WorkspaceRevisionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) revision!: number;
}
export class WorkspaceSaveDto extends WorkspaceRevisionDto {
  @ApiProperty({ required: false, description: "Full Yjs state, base64. Exactly one of snapshot/operations is required." })
  @IsOptional() @IsString() @MaxLength(22369624) snapshot?: string;
  @ApiProperty({ required: false, type: [Object], description: "Native editing commands applied immediately to the AI save only." })
  @IsOptional() @IsArray() @ArrayMaxSize(10000) @IsObject({ each: true }) operations?: Record<string, unknown>[];
}
export class WorkspaceMergeDto extends WorkspaceRevisionDto {
  @ApiProperty({ description: "Hash returned by compare; prevents resolving against a newer user save." })
  @Matches(/^[a-f0-9]{64}$/) latestHash!: string;
  @ApiProperty({ required: false, type: Object, description: "Conflicting unit id to draft/latest. Absent conflicts are reported without writing." })
  @IsOptional() @IsObject() resolutions?: Record<string, "draft" | "latest">;
}
export class WorkspacePreviewDto extends AiSnapshotDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) revision!: number;
}
export class WorkspaceReviewDto extends WorkspacePreviewDto {
  @ApiProperty({ description: "Hash of the exact editor snapshot previously previewed." })
  @Matches(/^[a-f0-9]{64}$/) currentHash!: string;
  @ApiProperty({ type: [String], description: "Merge-unit ids to accept, from preview." })
  @IsArray() @ArrayMaxSize(10000) @IsString({ each: true }) accepted!: string[];
  @ApiProperty({ type: [String], description: "Merge-unit ids to discard. Other AI changes remain pending." })
  @IsArray() @ArrayMaxSize(10000) @IsString({ each: true }) rejected!: string[];
  @ApiProperty({ required: false, type: Object }) @IsOptional() @IsObject() resolutions?: Record<string, "draft" | "latest">;
}
export class WorkspaceReadDto {
  @ApiProperty({ required: false, enum: ["draft", "base", "latest"] })
  @IsOptional() @IsIn(["draft", "base", "latest"]) source?: "draft" | "base" | "latest";
}
