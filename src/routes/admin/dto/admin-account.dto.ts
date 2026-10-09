import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { ROLE_NAMES, RoleName } from '../../../auth/access/roles';

/** An account as the admin console lists it. */
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
