import { ApiProperty, ApiHideProperty } from "@nestjs/swagger";

export class AuthResponseDto {
  @ApiProperty({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  access_token!: string;

  @ApiHideProperty()
  refresh_token!: string;
}
