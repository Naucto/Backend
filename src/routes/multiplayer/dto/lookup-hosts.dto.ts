import { GameSessionVisibility } from "@prisma/client";
import { IsArray, IsEnum, IsInt, IsUUID } from "class-validator";

export class LookupHostsResponseDtoHost {
  @IsUUID() 
    sessionUuid!: string;

  @IsEnum(GameSessionVisibility)
    sessionVisibility!: GameSessionVisibility;

  @IsInt()
    playerCount!: number;
};

// This might look pointless to make a struct like this, but it's actually
// useful for future expansion
export class LookupHostsResponseDto {
  @IsArray()
    hosts!: LookupHostsResponseDtoHost[];
};
