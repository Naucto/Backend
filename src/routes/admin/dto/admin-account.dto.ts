import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { ROLE_NAMES, RoleName } from '../../../auth/access/roles';

/** An account as the admin console lists it. */
export class AccountSummaryDto {
  @ApiProperty({ format: 'uuid', example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  nickname!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Null for a reader who does not read addresses: anyone but an admin',
  })
  email!: string | null;

  @ApiProperty({ enum: ROLE_NAMES })
  role!: RoleName;

  @ApiProperty()
  createdAt!: Date;
}

export class AdminAccountListDto {
  @ApiProperty({ type: [AccountSummaryDto] })
  items!: AccountSummaryDto[];
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
