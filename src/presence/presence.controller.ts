import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Req,
  UseGuards
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import { PresenceDto } from "./dto/presence.dto";
import { PresenceService } from "./presence.service";

@ApiTags("presence")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("presence")
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get("friends")
  @ApiOperation({ summary: "Presence of the caller's online friends" })
  @ApiResponse({ status: HttpStatus.OK, type: [PresenceDto] })
  async friends(@Req() req: RequestWithUser): Promise<PresenceDto[]> {
    return this.presenceService.friendsPresence(req.user.id);
  }
}

@ApiTags("users")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("users")
export class UserPresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get(":id/presence")
  @ApiOperation({ summary: "Presence of a user (404 when offline)" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: HttpStatus.OK, type: PresenceDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User is offline" })
  async presence(
    @Req() req: RequestWithUser,
    @Param("id", ParseIntPipe) id: number
  ): Promise<PresenceDto> {
    const state = await this.presenceService.presenceOf(req.user.id, id);
    if (!state) {
      throw new NotFoundException("User is offline");
    }
    return state;
  }
}
