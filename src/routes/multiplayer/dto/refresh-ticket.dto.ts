import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class RefreshTicketDto {
  // A ticket is minted for a connection, not for an account: an editor
  // self-join plays under a synthetic id that no account lookup can recover, so
  // a refresh that only knew the caller would hand that client the host's seat.
  @ApiPropertyOptional({
    description:
      "The ticket being replaced. When it was minted for this session, the " +
      "fresh one keeps its player id and role; otherwise the caller's account " +
      "decides both."
  })
  @IsOptional()
  @IsString()
    ticket?: string;
}
