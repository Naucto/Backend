import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SessionJoinPolicy } from "@prisma/client";
import { IsEnum, IsOptional } from "class-validator";

export class MeDto {
  @ApiProperty({
    description: "Code other users enter to send a friend request",
    example: "7K3QW9ZB"
  })
    friendCode!: string;

  @ApiProperty({
    enum: SessionJoinPolicy,
    enumName: "SessionJoinPolicy",
    description: "Who may join the game sessions this user hosts"
  })
    sessionJoinPolicy!: SessionJoinPolicy;
}

export class UpdateMeDto {
  @ApiPropertyOptional({
    enum: SessionJoinPolicy,
    enumName: "SessionJoinPolicy"
  })
  @IsOptional()
  @IsEnum(SessionJoinPolicy)
    sessionJoinPolicy?: SessionJoinPolicy;
}
