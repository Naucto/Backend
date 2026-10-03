import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Equals, IsBoolean, IsString, ValidateIf } from "class-validator";

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
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
    removePublishedGames?: boolean;

  @ApiPropertyOptional({
    description: "Current password; verified when provided on a password account"
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
    password?: string;
}
