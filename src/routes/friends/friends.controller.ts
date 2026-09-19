import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import {
  FriendDto,
  FriendRequestDto,
  FriendshipStatusDto,
  RecentPlayerDto
} from "./dto/friend.dto";
import { SendFriendRequestDto } from "./dto/send-friend-request.dto";
import { DEFAULT_RECENT_PLAYERS_DAYS, FriendsService } from "./friends.service";

@ApiTags("friends")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("friends")
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's friends" })
  @ApiResponse({ status: HttpStatus.OK, type: [FriendDto] })
  async list(@Req() req: RequestWithUser): Promise<FriendDto[]> {
    return this.friendsService.list(req.user.id);
  }

  @Get("requests")
  @ApiOperation({
    summary: "List pending friend requests (incoming and outgoing)"
  })
  @ApiResponse({ status: HttpStatus.OK, type: [FriendRequestDto] })
  async requests(@Req() req: RequestWithUser): Promise<FriendRequestDto[]> {
    return this.friendsService.requests(req.user.id);
  }

  @Post("requests")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Send a friend request by user id or friend code; a crossed request is accepted instead"
  })
  @ApiBody({ type: SendFriendRequestDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    type: FriendRequestDto,
    description: "The created request, or empty when a crossed request was auto-accepted"
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Target user not found" })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: "Already friends or already requested" })
  async send(
    @Req() req: RequestWithUser,
    @Body() dto: SendFriendRequestDto
  ): Promise<FriendRequestDto | null> {
    return this.friendsService.sendRequest(req.user.id, dto);
  }

  @Post("requests/:id/accept")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Accept an incoming friend request" })
  @ApiParam({ name: "id", description: "Friend request ID" })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Request not found" })
  async accept(
    @Req() req: RequestWithUser,
    @Param("id", ParseIntPipe) id: number
  ): Promise<void> {
    await this.friendsService.accept(req.user.id, id);
  }

  @Delete("requests/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Decline an incoming or cancel an outgoing friend request" })
  @ApiParam({ name: "id", description: "Friend request ID" })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Request not found" })
  async decline(
    @Req() req: RequestWithUser,
    @Param("id", ParseIntPipe) id: number
  ): Promise<void> {
    await this.friendsService.decline(req.user.id, id);
  }

  @Get("recent-players")
  @ApiOperation({ summary: "People the caller recently played with" })
  @ApiQuery({ name: "days", required: false, type: Number, description: "Look-back window (default 30)" })
  @ApiResponse({ status: HttpStatus.OK, type: [RecentPlayerDto] })
  async recentPlayers(
    @Req() req: RequestWithUser,
    @Query("days", new DefaultValuePipe(DEFAULT_RECENT_PLAYERS_DAYS), ParseIntPipe)
      days: number
  ): Promise<RecentPlayerDto[]> {
    return this.friendsService.recentPlayers(req.user.id, days);
  }

  @Delete(":userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a friend" })
  @ApiParam({ name: "userId", description: "ID of the friend to remove" })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Not friends" })
  async remove(
    @Req() req: RequestWithUser,
    @Param("userId", ParseIntPipe) userId: number
  ): Promise<void> {
    await this.friendsService.remove(req.user.id, userId);
  }
}

@ApiTags("users")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("users")
export class UserFriendshipController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get(":id/friendship")
  @ApiOperation({ summary: "Friendship status between the caller and a user" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: HttpStatus.OK, type: FriendshipStatusDto })
  async friendship(
    @Req() req: RequestWithUser,
    @Param("id", ParseIntPipe) id: number
  ): Promise<FriendshipStatusDto> {
    return {
      status: await this.friendsService.friendshipStatus(req.user.id, id)
    };
  }
}
