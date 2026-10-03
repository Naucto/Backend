import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  UseGuards,
  HttpCode,
  ParseIntPipe,
  Logger,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  Res,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { UserService } from "./user.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserFilterDto } from "./dto/user-filter.dto";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiExtraModels,
  ApiConsumes
} from "@nestjs/swagger";
import { Request } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RolesGuard } from "@auth/guards/roles.guard";
import { Roles } from "@auth/decorators/roles.decorator";
import { UserResponseDto } from "./dto/user-response.dto";
import { UserListResponseDto } from "./dto/user-list-response.dto";
import { UserSingleResponseDto } from "./dto/user-single-response.dto";
import { UserProfileResponseDto } from "./dto/user-profile-response.dto";
import { RequestWithUser } from "@auth/auth.types";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { S3Service } from "@s3/s3.service";
import { EdgeService, versionedUrl } from "src/routes/s3/edge.service";
import { UpdateUserProfileDto } from "./dto/update-user-profile.dto";
import { PublicUserProfileResponseDto } from "./dto/public-user-profile-response.dto";
import { MeDto, UpdateMeDto } from "./dto/me.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { ProfileImageUploadResponseDto } from "./dto/profile-image-upload-response.dto";
import { ProfileImageRemovedResponseDto } from "./dto/profile-image-removed-response.dto";
import { ProfileImageUrlDto } from "./dto/profile-image-url.dto";
import { UserRemovedResponseDto } from "./dto/user-removed-response.dto";
import { ProfileAsset, profileAssetKey } from "./profile-asset";
import { AccountDeletionService } from "./account-deletion.service";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "@auth/auth.utils";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|png|gif|webp)$/;

const PROFILE_IMAGE_PIPE = new ParseFilePipeBuilder()
  .addMaxSizeValidator({ maxSize: MAX_FILE_SIZE })
  .addFileTypeValidator({ fileType: ALLOWED_IMAGE_TYPES })
  // The object is stored and served under the type the client declared, so that type is held to
  // the same list as the one read from the content.
  .addFileTypeValidator({
    fileType: ALLOWED_IMAGE_TYPES,
    skipMagicNumbersValidation: true
  })
  .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

// Without a limit of its own the interceptor buffers the whole body before any validator runs.
const PROFILE_IMAGE_LIMITS = { fileSize: MAX_FILE_SIZE, files: 1 };

@ApiTags("users")
@ApiExtraModels(
  UserResponseDto,
  UserListResponseDto,
  UserSingleResponseDto,
  UserProfileResponseDto,
  PublicUserProfileResponseDto
)
@ApiBearerAuth("JWT-auth")
@Controller("users")
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
    private readonly edgeService: EdgeService,
    private readonly accountDeletionService: AccountDeletionService
  ) {}

  private async getPublicAssetUrl(key: string): Promise<string | null> {
    const head = await this.s3Service.getFileMetadataOrNull(key);
    if (!head) {
      return null;
    }

    return versionedUrl(this.edgeService.getCDNUrl(key), head.ETag);
  }

  @Get("profile")
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the current user profile",
    type: UserProfileResponseDto
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req: RequestWithUser): Promise<UserProfileResponseDto> {
    // The pictures are decoration here: a store that cannot be read costs them, not the answer.
    const urlOrNull = (asset: ProfileAsset): Promise<string | null> => {
      const key = profileAssetKey(req.user.id, asset);
      return this.getPublicAssetUrl(key).catch((error: unknown) => {
        this.logger.warn(`Profile image lookup failed for ${key}: ${String(error)}`);
        return null;
      });
    };
    const [profileImageUrl, backgroundImageUrl] = await Promise.all([
      urlOrNull("profile"),
      urlOrNull("background")
    ]);

    const { id, email, username, nickname, createdAt } = req.user;
    return {
      id,
      email,
      username,
      nickname: nickname ?? null,
      createdAt,
      profileImageUrl,
      backgroundImageUrl
    };
  }

  @Patch("profile")
  @ApiOperation({
    summary: "Update the parts of your own profile you write: names, description, accent"
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: "The handle asked for belongs to someone else"
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User profile updated successfully",
    type: PublicUserProfileResponseDto
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  async updateMyProfile(
    @Body() updateUserProfileDto: UpdateUserProfileDto,
    @Request() req: RequestWithUser
  ): Promise<PublicUserProfileResponseDto> {
    const { description, nickname, username, colour } = updateUserProfileDto;
    // Blank is an answer here: a zone the person emptied is cleared, not left as it was.
    const blankable = (value: string): string | null => value.trim() || null;

    const update: Parameters<UserService["updateMyProfile"]>[1] = {};
    if (description !== undefined) update.description = blankable(description);
    if (nickname !== undefined) update.nickname = blankable(nickname);
    if (username !== undefined) update.username = username.trim();
    if (colour !== undefined) update.colour = colour;

    const updated = await this.userService.updateMyProfile(req.user.id, update);

    const profileImageUrl = await this.getPublicAssetUrl(
      profileAssetKey(req.user.id, "profile")
    );
    const backgroundImageUrl = await this.getPublicAssetUrl(
      profileAssetKey(req.user.id, "background")
    );

    return {
      statusCode: HttpStatus.OK,
      message: "User profile updated successfully",
      data: {
        ...updated,
        profileImageUrl,
        backgroundImageUrl
      }
    };
  }

  // Declared before the ":id" routes so "me" is never parsed as a user id.
  @Get("me")
  @ApiOperation({ summary: "Get the current user's account settings" })
  @ApiResponse({ status: HttpStatus.OK, type: MeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: RequestWithUser): Promise<MeDto> {
    return this.userService.getMe(req.user.id);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update the current user's account settings" })
  @ApiBody({ type: UpdateMeDto })
  @ApiResponse({ status: HttpStatus.OK, type: MeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @Request() req: RequestWithUser,
    @Body() dto: UpdateMeDto
  ): Promise<MeDto> {
    return this.userService.updateMe(req.user.id, dto);
  }

  @Delete("me")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Delete the current account (soft-delete + anonymise; purges sessions, tokens, friends, notifications, unpublished games)"
  })
  @ApiBody({ type: DeleteAccountDto })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: "Account deleted, refresh cookie cleared" })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Missing DELETE confirmation" })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized or wrong password" })
  @UseGuards(JwtAuthGuard)
  async deleteMe(
    @Request() req: RequestWithUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    await this.accountDeletionService.deleteAccount(
      req.user.id,
      dto.removePublishedGames === true,
      dto.password
    );
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  }

  @Post("me/friend-code/regenerate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Replace the current user's friend code" })
  @ApiResponse({ status: HttpStatus.OK, type: MeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  async regenerateFriendCode(@Request() req: RequestWithUser): Promise<MeDto> {
    return this.userService.regenerateFriendCode(req.user.id);
  }

  private async uploadProfileAsset(
    id: number,
    req: RequestWithUser,
    file: Express.Multer.File,
    asset: ProfileAsset,
    label: string
  ): Promise<ProfileImageUploadResponseDto> {
    if (req.user.id !== id) {
      throw new ForbiddenException();
    }

    const key = profileAssetKey(id, asset);

    await this.s3Service.uploadFile({
      file,
      keyName: key,
      metadata: {
        uploadedBy: req.user.id.toString(),
        userId: id.toString(),
        originalName: file.originalname
      },
      cacheControl: "no-cache"
    });
    await this.s3Service.setObjectPublicRead(key);

    return {
      message: `${label} uploaded successfully`,
      id,
      // The unversioned address is still correct when the store cannot be read back yet; the
      // version only busts the browser cache.
      resourceUrl:
        (await this.getPublicAssetUrl(key)) ??
        this.edgeService.getCDNUrl(key)
    };
  }

  @Post(":id/profile-picture")
  @ApiOperation({ summary: "Upload a user's profile picture" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Profile picture file"
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "Profile uploaded",
    type: ProfileImageUploadResponseDto
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: PROFILE_IMAGE_LIMITS }))
  @HttpCode(HttpStatus.CREATED)
  async uploadProfilePicture(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile(PROFILE_IMAGE_PIPE) file: Express.Multer.File,
    @Request() req: RequestWithUser
  ): Promise<ProfileImageUploadResponseDto> {
    return this.uploadProfileAsset(id, req, file, "profile", "Profile picture");
  }

  /** Drops one of the two profile images; idempotent, so removing an absent image succeeds. */
  private async removeProfileAsset(
    id: number,
    req: RequestWithUser,
    asset: ProfileAsset,
    label: string
  ): Promise<ProfileImageRemovedResponseDto> {
    if (req.user.id !== id) {
      throw new ForbiddenException();
    }

    await this.s3Service.deleteFile({ key: profileAssetKey(id, asset) });

    return { message: `${label} removed successfully`, id };
  }

  @Delete(":id/profile-picture")
  @ApiOperation({ summary: "Remove your own profile picture" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Removed, or there was none",
    type: ProfileImageRemovedResponseDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "Not your profile" })
  @UseGuards(JwtAuthGuard)
  async removeProfilePicture(
    @Param("id", ParseIntPipe) id: number,
    @Request() req: RequestWithUser
  ): Promise<ProfileImageRemovedResponseDto> {
    return this.removeProfileAsset(id, req, "profile", "Profile picture");
  }

  @Post(":id/profile-background")
  @ApiOperation({ summary: "Upload a user's profile background" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Profile background file"
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "Profile background uploaded",
    type: ProfileImageUploadResponseDto
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: PROFILE_IMAGE_LIMITS }))
  @HttpCode(HttpStatus.CREATED)
  async uploadProfileBackground(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile(PROFILE_IMAGE_PIPE) file: Express.Multer.File,
    @Request() req: RequestWithUser
  ): Promise<ProfileImageUploadResponseDto> {
    return this.uploadProfileAsset(id, req, file, "background", "Profile background");
  }

  @Delete(":id/profile-background")
  @ApiOperation({ summary: "Remove your own profile background" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Removed, or there was none",
    type: ProfileImageRemovedResponseDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "Not your profile" })
  @UseGuards(JwtAuthGuard)
  async removeProfileBackground(
    @Param("id", ParseIntPipe) id: number,
    @Request() req: RequestWithUser
  ): Promise<ProfileImageRemovedResponseDto> {
    return this.removeProfileAsset(id, req, "background", "Profile background");
  }

  @Get(":id/profile-picture")
  @ApiOperation({
    summary: "Get the public CDN URL of a user's profile picture"
  })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Public CDN URL of the picture",
    type: ProfileImageUrlDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Not found" })
  @UseGuards(JwtAuthGuard)
  async getProfilePicture(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ProfileImageUrlDto> {
    const resourceUrl = await this.getPublicAssetUrl(profileAssetKey(id, "profile"));
    if (!resourceUrl) {
      throw new NotFoundException("Profile picture not found");
    }

    return { resourceUrl };
  }

  @Get()
  @ApiOperation({ summary: "Get all users with pagination and filtering" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns paginated list of users",
    type: UserListResponseDto
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions"
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("Admin")
  async findAll(@Query() filterDto: UserFilterDto): Promise<UserListResponseDto> {
    this.logger.debug(
      `Fetching users with pagination: ${JSON.stringify(filterDto)}`
    );

    const { users, total, page, limit } =
      await this.userService.findPage(filterDto);

    return {
      statusCode: HttpStatus.OK,
      message: "Users retrieved successfully",
      data: users,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a user by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the user",
    type: UserSingleResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid ID format"
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions"
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("Admin")
  async findOne(
    @Param("id", ParseIntPipe) id: number
  ): Promise<UserSingleResponseDto> {
    this.logger.debug(`Fetching user with ID: ${id}`);
    const user = await this.userService.findAccount(id);

    return {
      statusCode: HttpStatus.OK,
      message: "User retrieved successfully",
      data: user
    };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a user by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User updated successfully",
    type: UserSingleResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Invalid input" })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions"
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("Admin")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto
  ): Promise<UserSingleResponseDto> {
    this.logger.debug(`Updating user with ID: ${id}`);
    const user = await this.userService.update(id, updateUserDto);

    return {
      statusCode: HttpStatus.OK,
      message: "User updated successfully",
      data: user
    };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a user by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User deleted successfully",
    type: UserRemovedResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions"
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("Admin")
  async remove(
    @Param("id", ParseIntPipe) id: number
  ): Promise<UserRemovedResponseDto> {
    this.logger.debug(`Deleting user with ID: ${id}`);
    await this.accountDeletionService.deleteAccount(id, false);

    return {
      statusCode: HttpStatus.OK,
      message: "User deleted successfully"
    };
  }
}
