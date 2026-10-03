import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class RefreshTicketDto {
  @ApiPropertyOptional({
    description:
      "The ticket being replaced. When it was minted for this session and " +
      "for a seat the caller holds, the fresh one keeps its player id and " +
      "role; otherwise the caller's account decides both."
  })
  @IsOptional()
  @IsString()
    ticket?: string;
}
