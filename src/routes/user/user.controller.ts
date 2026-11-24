import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { AllowedWhileSuspended, RequiresAuth } from '../../auth/access/access.decorators';
import { currentSuspension } from '../../auth/access/suspension';
import { RequestWithUser } from '../../auth/auth.types';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../../auth/auth.utils';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { MeDto, UpdateMeDto } from './dto/me.dto';
import { ProfileImageRemovedResponseDto } from './dto/profile-image-removed-response.dto';
import { ProfileImageUploadResponseDto } from './dto/profile-image-upload-response.dto';
import { ProfileImageUrlDto } from './dto/profile-image-url.dto';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ProfileAsset, ProfileAssetService } from './profile-asset.service';
import { UserService } from './user.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|png|gif|webp)$/;

const PROFILE_IMAGE_PIPE = new ParseFilePipeBuilder()
  .addMaxSizeValidator({ maxSize: MAX_FILE_SIZE })
  .addFileTypeValidator({ fileType: ALLOWED_IMAGE_TYPES })
  // The object is stored and served under the type the client declared, so that type is held to
  // the same list as the one read from the content.
  .addFileTypeValidator({
    fileType: ALLOWED_IMAGE_TYPES,
    skipMagicNumbersValidation: true,
  })
  .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

// Without a limit of its own the interceptor buffers the whole body before any validator runs.
const PROFILE_IMAGE_LIMITS = { fileSize: MAX_FILE_SIZE, files: 1 };

@ApiTags('users')
@ApiExtraModels(UserResponseDto, UserProfileResponseDto, PublicUserProfileResponseDto)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly profileAssetService: ProfileAssetService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the current user profile',
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @RequiresAuth()
  async getProfile(@Request() req: RequestWithUser): Promise<UserProfileResponseDto> {
    const imageUrls = await this.profileAssetService.imageUrls(req.user.id);

    const { id, email, username, nickname, role, createdAt } = req.user;
    return {
      id,
      email,
      username,
      nickname: nickname ?? null,
      role,
      createdAt,
      ...imageUrls,
      suspension: currentSuspension(req.user),
    };
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Update the parts of your own profile you write: names, description, accent',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'The handle asked for belongs to someone else',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User profile updated successfully',
    type: PublicUserProfileResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @RequiresAuth()
  async updateMyProfile(
    @Body() updateUserProfileDto: UpdateUserProfileDto,
    @Request() req: RequestWithUser,
  ): Promise<PublicUserProfileResponseDto> {
    const { description, nickname, username, colour } = updateUserProfileDto;
    // Blank is an answer here: a zone the person emptied is cleared, not left as it was.
    const blankable = (value: string): string | null => value.trim() || null;

    const update: Parameters<UserService['updateMyProfile']>[1] = {};
    if (description !== undefined) {
      update.description = blankable(description);
    }
    if (nickname !== undefined) {
      update.nickname = blankable(nickname);
    }
    if (username !== undefined) {
      update.username = username.trim();
    }
    if (colour !== undefined) {
      update.colour = colour;
    }

    const updated = await this.userService.updateMyProfile(req.user.id, update);

    return {
      statusCode: HttpStatus.OK,
      message: 'User profile updated successfully',
      data: {
        ...updated,
        ...(await this.profileAssetService.imageUrls(req.user.id)),
      },
    };
  }

  // Declared before the ":id" routes so "me" is never parsed as a user id.
  @Get('me')
  @ApiOperation({ summary: "Get the current user's account settings" })
  @ApiResponse({ status: HttpStatus.OK, type: MeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @RequiresAuth()
  async getMe(@Request() req: RequestWithUser): Promise<MeDto> {
    return this.userService.getMe(req.user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the current user's account settings" })
  @ApiBody({ type: UpdateMeDto })
  @ApiResponse({ status: HttpStatus.OK, type: MeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @RequiresAuth()
  async updateMe(@Request() req: RequestWithUser, @Body() dto: UpdateMeDto): Promise<MeDto> {
    return this.userService.updateMe(req.user.id, dto);
  }

  @Delete('me')
  @AllowedWhileSuspended()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete the current account (soft-delete + anonymise; purges sessions, tokens, friends, notifications, unpublished games)',
  })
  @ApiBody({ type: DeleteAccountDto })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Account deleted, refresh cookie cleared',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing DELETE confirmation' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized or wrong password' })
  @RequiresAuth()
  async deleteMe(
    @Request() req: RequestWithUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.accountDeletionService.deleteAccount(
      req.user.id,
      dto.removePublishedGames === true,
      {
        by: 'self',
        password: dto.password,
      },
    );
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  }

  @Post('me/friend-code/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Replace the current user's friend code" })
  @ApiResponse({ status: HttpStatus.OK, type: MeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @RequiresAuth()
  async regenerateFriendCode(@Request() req: RequestWithUser): Promise<MeDto> {
    return this.userService.regenerateFriendCode(req.user.id);
  }

  private async uploadProfileAsset(
    id: string,
    req: RequestWithUser,
    file: Express.Multer.File,
    asset: ProfileAsset,
    label: string,
  ): Promise<ProfileImageUploadResponseDto> {
    if (req.user.id !== id) {
      throw new ForbiddenException();
    }

    return {
      message: `${label} uploaded successfully`,
      id,
      resourceUrl: await this.profileAssetService.store(id, asset, file),
    };
  }

  @Post(':id/profile-picture')
  @ApiOperation({ summary: "Upload a user's profile picture" })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'User ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Profile picture file',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Profile uploaded',
    type: ProfileImageUploadResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @RequiresAuth()
  @UseInterceptors(FileInterceptor('file', { limits: PROFILE_IMAGE_LIMITS }))
  @HttpCode(HttpStatus.CREATED)
  async uploadProfilePicture(
    @Param('id', ParseIdPipe) id: string,
    @UploadedFile(PROFILE_IMAGE_PIPE) file: Express.Multer.File,
    @Request() req: RequestWithUser,
  ): Promise<ProfileImageUploadResponseDto> {
    return this.uploadProfileAsset(id, req, file, 'profile', 'Profile picture');
  }

  /** Drops one of the two profile images; idempotent, so removing an absent image succeeds. */
  private async removeProfileAsset(
    id: string,
    req: RequestWithUser,
    asset: ProfileAsset,
    label: string,
  ): Promise<ProfileImageRemovedResponseDto> {
    if (req.user.id !== id) {
      throw new ForbiddenException();
    }

    await this.profileAssetService.remove(id, asset);

    return { message: `${label} removed successfully`, id };
  }

  @Delete(':id/profile-picture')
  @AllowedWhileSuspended()
  @ApiOperation({ summary: 'Remove your own profile picture' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'User ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Removed, or there was none',
    type: ProfileImageRemovedResponseDto,
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not your profile' })
  @RequiresAuth()
  async removeProfilePicture(
    @Param('id', ParseIdPipe) id: string,
    @Request() req: RequestWithUser,
  ): Promise<ProfileImageRemovedResponseDto> {
    return this.removeProfileAsset(id, req, 'profile', 'Profile picture');
  }

  @Post(':id/profile-background')
  @ApiOperation({ summary: "Upload a user's profile background" })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'User ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Profile background file',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Profile background uploaded',
    type: ProfileImageUploadResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @RequiresAuth()
  @UseInterceptors(FileInterceptor('file', { limits: PROFILE_IMAGE_LIMITS }))
  @HttpCode(HttpStatus.CREATED)
  async uploadProfileBackground(
    @Param('id', ParseIdPipe) id: string,
    @UploadedFile(PROFILE_IMAGE_PIPE) file: Express.Multer.File,
    @Request() req: RequestWithUser,
  ): Promise<ProfileImageUploadResponseDto> {
    return this.uploadProfileAsset(id, req, file, 'background', 'Profile background');
  }

  @Delete(':id/profile-background')
  @AllowedWhileSuspended()
  @ApiOperation({ summary: 'Remove your own profile background' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'User ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Removed, or there was none',
    type: ProfileImageRemovedResponseDto,
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not your profile' })
  @RequiresAuth()
  async removeProfileBackground(
    @Param('id', ParseIdPipe) id: string,
    @Request() req: RequestWithUser,
  ): Promise<ProfileImageRemovedResponseDto> {
    return this.removeProfileAsset(id, req, 'background', 'Profile background');
  }

  @Get(':id/profile-picture')
  @ApiOperation({
    summary: "Get the public CDN URL of a user's profile picture",
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'User ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Public CDN URL of the picture',
    type: ProfileImageUrlDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @RequiresAuth()
  async getProfilePicture(@Param('id', ParseIdPipe) id: string): Promise<ProfileImageUrlDto> {
    const resourceUrl = await this.profileAssetService.url(id, 'profile');
    if (!resourceUrl) {
      throw new NotFoundException('Profile picture not found');
    }

    return { resourceUrl };
  }
}
