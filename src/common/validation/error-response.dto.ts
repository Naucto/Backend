import { ApiProperty } from "@nestjs/swagger";
import { ViolationDto } from "./violation";

/**
 * A rejected request, described twice over: `message` in prose for anyone reading a log, and
 * `violations` in codes for a form that has to decide which field to point at.
 */
export class ValidationErrorResponseDto {
  @ApiProperty({ example: 400 })
    statusCode!: number;

  @ApiProperty({ example: "Bad Request" })
    error!: string;

  @ApiProperty({ type: [String], example: [ "Password must be at least 8 characters" ] })
    message!: string[];

  @ApiProperty({ type: () => [ViolationDto] })
    violations!: ViolationDto[];
}

/** The same account of a rejection, for the conflicts a validator cannot see on its own. */
export class ConflictErrorResponseDto {
  @ApiProperty({ example: 409 })
    statusCode!: number;

  @ApiProperty({ example: "Conflict" })
    error!: string;

  @ApiProperty({ example: "Email already in use" })
    message!: string;

  @ApiProperty({ type: () => [ViolationDto] })
    violations!: ViolationDto[];
}
