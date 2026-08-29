import { ApiProperty } from "@nestjs/swagger";

/** One autosave or checkpoint blob in S3. */
export class ProjectSaveDto {
  @ApiProperty({
    description: "Object name inside the project's save prefix",
    example: "1742901234567"
  })
    name!: string;

  @ApiProperty({
    description: "When the blob was written",
    example: "2025-03-25T11:20:34.000Z"
  })
    date!: Date;
}

/**
 * Typed on purpose: without it these endpoints generate as `200: unknown`, and the editor's
 * versions popover silently rendered an empty list because it could not know the array was
 * wrapped in an object.
 */
export class ProjectVersionsResponseDto {
  @ApiProperty({ type: [ProjectSaveDto], description: "Autosaves, newest last" })
    versions!: ProjectSaveDto[];
}

export class ProjectCheckpointsResponseDto {
  @ApiProperty({ type: [ProjectSaveDto], description: "Named checkpoints" })
    checkpoints!: ProjectSaveDto[];
}
