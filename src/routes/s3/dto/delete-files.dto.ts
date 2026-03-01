import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsString } from "class-validator";

export class DeleteS3FilesDto {
  @ApiProperty({
    description: "List of object keys to delete",
    type: [String],
    example: ["file1.jpg", "documents/report.pdf"]
  })
  @IsArray()
  @IsString({ each: true })
  readonly keys!: string[];
}
