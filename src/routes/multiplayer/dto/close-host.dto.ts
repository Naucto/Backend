import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

// FIXME: If we need to support more than one game session per project/game, this should be
//        modified as well to use sessionUuid over projectId.
export class CloseHostRequestDto {
  @ApiProperty({ description: "ID of the project whose session to close" })
  @IsUUID()
    projectId!: number;
};
