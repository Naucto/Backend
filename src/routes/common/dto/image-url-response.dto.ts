import { ApiProperty } from "@nestjs/swagger";

export class ImageUrlResponseDto {
  @ApiProperty({
    example: "https://cdn.example.com/projects/42/image",
    description: "The public CDN URL for the image"
  })
  url!: string;
}
