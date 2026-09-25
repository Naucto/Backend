import { UserWithDetailsDto } from "@user/dto/user-with-details.dto";
import { ApiExtraModels, ApiProperty, getSchemaPath } from "@nestjs/swagger";
import { UserResponseDto } from "./user-response.dto";

@ApiExtraModels(UserResponseDto, UserWithDetailsDto)
export class UserSingleResponseDto {
  @ApiProperty({ description: "HTTP status code", example: 200 })
  statusCode!: number;

  @ApiProperty({
    description: "Response message",
    example: "User retrieved successfully"
  })
  message!: string;

  @ApiProperty({ description: "User data", oneOf: [{ $ref: getSchemaPath(UserResponseDto) }, { $ref: getSchemaPath(UserWithDetailsDto) }] })
  data!: UserResponseDto | UserWithDetailsDto;
}
