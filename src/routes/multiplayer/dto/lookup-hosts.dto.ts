import { ApiProperty } from "@nestjs/swagger";
import { GameSessionVisibility } from "@prisma/client";
import { IsArray, IsEnum, IsInt, IsUUID } from "class-validator";

export class LookupHostsResponseDtoHost {
  @ApiProperty()
  @IsUUID() 
    sessionUuid!: string;

  @ApiProperty({ enum: GameSessionVisibility })
  @IsEnum(GameSessionVisibility)
    sessionVisibility!: GameSessionVisibility;

  @ApiProperty()
  @IsInt()
    playerCount!: number;
};

// This might look pointless to make a struct like this, but it's actually
// useful for future expansion
export class LookupHostsResponseDto {
  @ApiProperty({ type: () => [LookupHostsResponseDtoHost] })
  @IsArray()
    hosts!: LookupHostsResponseDtoHost[];
};
