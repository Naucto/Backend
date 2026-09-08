import { ApiProperty } from "@nestjs/swagger";

/** One tag and how many published games carry it. */
export class ReleaseTagDto {
  @ApiProperty({ description: "The tag, written as the games carry it", example: "snake" })
    tag!: string;

  @ApiProperty({ description: "Published games carrying it", example: 14 })
    count!: number;
}

export class ReleaseTagsResponseDto {
  @ApiProperty({ description: "Tags, most used first", type: [ReleaseTagDto] })
    tags!: ReleaseTagDto[];
}
