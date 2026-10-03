import { ApiProperty } from "@nestjs/swagger";

/** Which parts of the product a deployment is showing. */
export class FeaturesResponseDto {
  @ApiProperty({
    description:
      "Whether a game's monetization settings are offered. Off unless a deployment turns it on.",
    example: false
  })
    monetization!: boolean;
}
