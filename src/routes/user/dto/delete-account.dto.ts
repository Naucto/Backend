import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Equals, IsBoolean, IsOptional, IsString } from "class-validator";

export class DeleteAccountDto {
  @ApiProperty({
    description: "Must be the literal string DELETE",
    example: "DELETE",
    enum: ["DELETE"]
  })
  @Equals("DELETE")
    confirmation!: "DELETE";

  @ApiPropertyOptional({
    description:
      "Also remove the user's published games (default: keep them, attributed to Deleted user)",
    default: false
  })
  @IsOptional()
  @IsBoolean()
    removePublishedGames?: boolean;

  @ApiPropertyOptional({
    description: "Current password; verified when provided on a password account"
  })
  @IsOptional()
  @IsString()
    password?: string;
}
