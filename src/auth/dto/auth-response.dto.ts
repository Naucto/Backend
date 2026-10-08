import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

/** What a sign-in answers with; the refresh token travels in a cookie instead. */
export class AccessTokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  access_token!: string;
}

/** The pair a sign-in mints; only the access token leaves in the body. */
export class AuthResponseDto extends AccessTokenResponseDto {
  @ApiHideProperty()
  refresh_token!: string;
}
