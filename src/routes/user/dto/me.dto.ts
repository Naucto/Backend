import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionJoinPolicy } from '@prisma/client';
import { IsBoolean, IsEnum, ValidateIf } from 'class-validator';

export class MeDto {
  @ApiProperty({
    description: 'Code other users enter to send a friend request',
    example: '7K3QW9ZB',
  })
  friendCode!: string;

  @ApiProperty({
    enum: SessionJoinPolicy,
    enumName: 'SessionJoinPolicy',
    description: 'Who may join the game sessions this user hosts',
  })
  sessionJoinPolicy!: SessionJoinPolicy;

  @ApiProperty({
    description:
      'Whether the account signs in with a password, which deleting it then has to be given',
  })
  hasPassword!: boolean;

  @ApiProperty({ description: 'Whether notifications are also sent by mail' })
  emailNotifications!: boolean;
}

export class UpdateMeDto {
  @ApiPropertyOptional({
    enum: SessionJoinPolicy,
    enumName: 'SessionJoinPolicy',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(SessionJoinPolicy)
  sessionJoinPolicy?: SessionJoinPolicy;

  @ApiPropertyOptional({ description: 'Whether notifications are also sent by mail' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  emailNotifications?: boolean;
}
