import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { ROLE_NAMES, RoleName } from '../../../auth/access/roles';

/** An account as the admin panel lists it. */
export class AccountSummaryDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ROLE_NAMES })
  role!: RoleName;

  @ApiProperty()
  createdAt!: Date;
}

export class AdminAccountDto extends AccountSummaryDto {
  @ApiProperty({ description: 'Whether signing in to the admin panel asks for a code' })
  twoFactorEnabled!: boolean;

  @ApiPropertyOptional({ type: Date, nullable: true })
  twoFactorEnabledAt!: Date | null;
}

export class AdminMeDto extends AdminAccountDto {
  @ApiProperty({ description: 'Whether this session went through the code step' })
  sessionVerified!: boolean;
}

export class AdminAccountListDto {
  @ApiProperty({ type: [AdminAccountDto] })
  items!: AdminAccountDto[];
}

export class AccountSearchQueryDto {
  @ApiProperty({ description: 'Part of a handle, display name or email', minLength: 2 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  term!: string;
}

export class AccountSearchResultDto {
  @ApiProperty({ type: [AccountSummaryDto] })
  items!: AccountSummaryDto[];
}

export class SetRoleDto {
  @ApiProperty({ enum: ROLE_NAMES })
  @IsIn(ROLE_NAMES)
  role!: RoleName;
}

export class TwoFactorSetupDto {
  @ApiProperty({ description: 'Base32 secret, for entering by hand' })
  secret!: string;

  @ApiProperty({ description: '`otpauth://` URI to show as a QR code' })
  otpauthUri!: string;

  @ApiProperty({
    description: 'Valid ten minutes; carries the candidate secret to the confirm step',
  })
  setupToken!: string;
}

export class TwoFactorConfirmDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  setupToken!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'The code is 6 digits' })
  code!: string;
}

export class TwoFactorCodeDto {
  @ApiProperty({
    example: '123456',
    description: 'A current code, proving the authenticator is at hand',
  })
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'The code is 6 digits' })
  code!: string;
}
