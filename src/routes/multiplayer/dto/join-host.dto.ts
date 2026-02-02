import { IsUUID } from "class-validator";

export class JoinHostRequestDto {
  @IsUUID()
    sessionUuid!: string;
};
