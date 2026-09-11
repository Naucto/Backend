import { ApiProperty } from "@nestjs/swagger";
import { PasswordCharacterClass } from "@auth/password-policy";

/** What a password must satisfy, so a form can say so before the request goes out. */
export class PasswordPolicyDto {
  @ApiProperty({ description: "Fewest characters a password may hold", example: 8 })
    minLength!: number;

  @ApiProperty({
    description: "How many of the character classes below a password must draw on",
    example: 2
  })
    minCharacterClasses!: number;

  @ApiProperty({
    description: "The classes that count towards minCharacterClasses",
    enum: PasswordCharacterClass,
    isArray: true,
    example: [ PasswordCharacterClass.LETTERS, PasswordCharacterClass.DIGITS ]
  })
    characterClasses!: PasswordCharacterClass[];
}
