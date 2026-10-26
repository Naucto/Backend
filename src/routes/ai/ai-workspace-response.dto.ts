import { ApiProperty } from "@nestjs/swagger";

export class WorkspaceSaveResponseDto {
  @ApiProperty() revision!: number;
  @ApiProperty({ nullable: true, type: String }) pendingReviewId!: string | null;
  @ApiProperty({ enum: ["draft", "base", "latest"] }) source!: "draft" | "base" | "latest";
  @ApiProperty() hash!: string;
  @ApiProperty({ description: "Native Yjs state encoded as base64, including audio samples." }) snapshot!: string;
  @ApiProperty({ type: Object }) content!: Record<string, unknown>;
  @ApiProperty() updatedAt!: Date;
}
export class WorkspaceDifferenceDto {
  @ApiProperty({ description: "code:<file id>, graphics, sound, network or metadata" }) id!: string;
  @ApiProperty({ nullable: true, type: String }) baseHash!: string | null;
  @ApiProperty({ nullable: true, type: String }) draftHash!: string | null;
  @ApiProperty({ nullable: true, type: String }) latestHash!: string | null;
  @ApiProperty() draftChanged!: boolean;
  @ApiProperty() latestChanged!: boolean;
  @ApiProperty() conflict!: boolean;
}
export class WorkspaceComparisonDto {
  @ApiProperty() revision!: number;
  @ApiProperty({ nullable: true, type: String }) pendingReviewId!: string | null;
  @ApiProperty() latestHash!: string;
  @ApiProperty({ type: [WorkspaceDifferenceDto] }) changes!: WorkspaceDifferenceDto[];
}
export class WorkspaceMergeResponseDto {
  @ApiProperty() revision!: number;
  @ApiProperty() merged!: boolean;
  @ApiProperty({ type: [WorkspaceDifferenceDto] }) conflicts!: WorkspaceDifferenceDto[];
  @ApiProperty({ required: false, type: WorkspaceSaveResponseDto }) save?: WorkspaceSaveResponseDto;
}
export class WorkspaceReviewResponseDto {
  @ApiProperty() reviewId!: string;
  @ApiProperty() revision!: number;
  @ApiProperty({ description: "Apply this state locally and persist it using normal project save." }) snapshot!: string;
  @ApiProperty() requiresSaveConfirmation!: boolean;
}
export class WorkspaceConfirmedDto extends WorkspaceSaveResponseDto {
  @ApiProperty() confirmed!: boolean;
}

export class WorkspaceStoredReviewDto extends WorkspaceReviewResponseDto {
  @ApiProperty({ enum: ["PREPARED", "CONFIRMED", "CANCELLED"] }) status!: string;
}
