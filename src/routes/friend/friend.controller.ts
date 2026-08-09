import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import { FriendService } from "./friend.service";
import {
  AlreadyFriendsError,
  CannotFriendYourselfError,
  FriendRequestAlreadyExistsError,
  FriendRequestNotFoundError,
  FriendshipNotFoundError,
  UnauthorizedFriendActionError,
} from "./friend.error";
import { FriendResponseDto, FriendListResponseDto } from "./dto/friend-response.dto";
import {
  FriendRequestResponseDto,
  FriendRequestListResponseDto,
  FriendRequestSingleResponseDto,
} from "./dto/friend-request-response.dto";
import { FriendshipStatusResponseDto } from "./dto/friendship-status-response.dto";
import { FriendCountResponseDto } from "./dto/friend-count-response.dto";

@ApiTags("friends")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@ApiExtraModels(
  FriendResponseDto,
  FriendListResponseDto,
  FriendRequestResponseDto,
  FriendRequestListResponseDto,
  FriendRequestSingleResponseDto,
  FriendshipStatusResponseDto,
  FriendCountResponseDto,
)
@Controller("friends")
export class FriendController {
  private readonly _logger = new Logger(FriendController.name);

  constructor(private readonly friendService: FriendService) {}

  @Post("request/:userId")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Send a friend request to another user" })
  @ApiParam({ name: "userId", description: "Target user ID" })
  @ApiResponse({ status: HttpStatus.CREATED, type: FriendRequestSingleResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Already friends or request already exists" })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Target user not found" })
  async sendFriendRequest(
    @Request() req: RequestWithUser,
    @Param("userId", ParseIntPipe) targetUserId: number,
  ): Promise<FriendRequestSingleResponseDto> {
    try {
      const data = await this.friendService.sendRequest(req.user.id, targetUserId);
      return { statusCode: HttpStatus.CREATED, message: "Friend request sent successfully", data };
    } catch (error) {
      if (
        error instanceof CannotFriendYourselfError ||
        error instanceof AlreadyFriendsError ||
        error instanceof FriendRequestAlreadyExistsError
      ) {
        throw new BadRequestException(error.message);
      }
      this._logger.error(`sendFriendRequest error: ${String(error)}`);
      throw error;
    }
  }

  @Delete("request/:requestId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Cancel a sent request or decline a received request" })
  @ApiParam({ name: "requestId", description: "Friend request ID" })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: "Request deleted" })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Request not found" })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "Not part of this request" })
  async cancelOrRejectFriendRequest(
    @Request() req: RequestWithUser,
    @Param("requestId", ParseIntPipe) requestId: number,
  ): Promise<void> {
    try {
      await this.friendService.cancelOrRejectRequest(requestId, req.user.id);
    } catch (error) {
      if (error instanceof FriendRequestNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof UnauthorizedFriendActionError) throw new ForbiddenException(error.message);
      this._logger.error(`cancelOrRejectFriendRequest error: ${String(error)}`);
      throw error;
    }
  }

  @Patch("request/:requestId/accept")
  @ApiOperation({ summary: "Accept a received friend request" })
  @ApiParam({ name: "requestId", description: "Friend request ID" })
  @ApiResponse({ status: HttpStatus.OK, description: "Friendship created" })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Request not found" })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "Only the recipient can accept" })
  async acceptFriendRequest(
    @Request() req: RequestWithUser,
    @Param("requestId", ParseIntPipe) requestId: number,
  ): Promise<{ statusCode: number; message: string }> {
    try {
      await this.friendService.acceptRequest(requestId, req.user.id);
      return { statusCode: HttpStatus.OK, message: "Friend request accepted" };
    } catch (error) {
      if (error instanceof FriendRequestNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof UnauthorizedFriendActionError) throw new ForbiddenException(error.message);
      this._logger.error(`acceptFriendRequest error: ${String(error)}`);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: "Get my friend list" })
  @ApiResponse({ status: HttpStatus.OK, type: FriendListResponseDto })
  async getMyFriends(@Request() req: RequestWithUser): Promise<FriendListResponseDto> {
    const data = await this.friendService.getMyFriends(req.user.id);
    return { statusCode: HttpStatus.OK, message: "Friends retrieved successfully", data };
  }

  @Get("requests/received")
  @ApiOperation({ summary: "Get pending friend requests received" })
  @ApiResponse({ status: HttpStatus.OK, type: FriendRequestListResponseDto })
  async getReceivedRequests(@Request() req: RequestWithUser): Promise<FriendRequestListResponseDto> {
    const data = await this.friendService.getReceivedRequests(req.user.id);
    return { statusCode: HttpStatus.OK, message: "Received friend requests retrieved successfully", data };
  }

  @Get("requests/sent")
  @ApiOperation({ summary: "Get pending friend requests sent" })
  @ApiResponse({ status: HttpStatus.OK, type: FriendRequestListResponseDto })
  async getSentRequests(@Request() req: RequestWithUser): Promise<FriendRequestListResponseDto> {
    const data = await this.friendService.getSentRequests(req.user.id);
    return { statusCode: HttpStatus.OK, message: "Sent friend requests retrieved successfully", data };
  }

  @Get("count")
  @ApiOperation({ summary: "Get my friend count" })
  @ApiResponse({ status: HttpStatus.OK, type: FriendCountResponseDto })
  async getMyFriendCount(@Request() req: RequestWithUser): Promise<FriendCountResponseDto> {
    const count = await this.friendService.countFriends(req.user.id);
    return { statusCode: HttpStatus.OK, message: "Friend count retrieved successfully", data: { count } };
  }

  @Get("count/:userId")
  @ApiOperation({ summary: "Get friend count for a given user" })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiResponse({ status: HttpStatus.OK, type: FriendCountResponseDto })
  async getFriendCount(
    @Param("userId", ParseIntPipe) userId: number,
  ): Promise<FriendCountResponseDto> {
    const count = await this.friendService.countFriends(userId);
    return { statusCode: HttpStatus.OK, message: "Friend count retrieved successfully", data: { count } };
  }

  @Get("status/:userId")
  @ApiOperation({ summary: "Get friendship status with another user" })
  @ApiParam({ name: "userId", description: "Target user ID" })
  @ApiResponse({ status: HttpStatus.OK, type: FriendshipStatusResponseDto })
  async getFriendshipStatus(
    @Request() req: RequestWithUser,
    @Param("userId", ParseIntPipe) targetId: number,
  ): Promise<FriendshipStatusResponseDto> {
    const data = await this.friendService.getFriendshipStatus(req.user.id, targetId);
    return { statusCode: HttpStatus.OK, message: "Friendship status retrieved successfully", data };
  }

  @Delete(":userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a friend" })
  @ApiParam({ name: "userId", description: "Friend user ID" })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: "Friend removed" })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Friendship not found" })
  async removeFriend(
    @Request() req: RequestWithUser,
    @Param("userId", ParseIntPipe) friendId: number,
  ): Promise<void> {
    try {
      await this.friendService.removeFriend(req.user.id, friendId);
    } catch (error) {
      if (error instanceof FriendshipNotFoundError) throw new NotFoundException(error.message);
      this._logger.warn(`removeFriend error: ${String(error)}`);
      throw error;
    }
  }
}
