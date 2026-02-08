import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  UseGuards,
  HttpCode,
  ParseIntPipe,
  ValidationPipe,
  Logger,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UserService } from "./user.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserFilterDto } from "./dto/user-filter.dto";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiExtraModels,
  ApiConsumes,
} from "@nestjs/swagger";
import { Request } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RolesGuard } from "@auth/guards/roles.guard";
import { Roles } from "@auth/decorators/roles.decorator";
import { Prisma } from "@prisma/client";
import { UserResponseDto } from "./dto/user-response.dto";
import { UserListResponseDto } from "./dto/user-list-response.dto";
import { UserSingleResponseDto } from "./dto/user-single-response.dto";
import { UserProfileResponseDto } from "./dto/user-profile-response.dto";
import { RequestWithUser } from "@auth/auth.types";
import { UserDto } from "@auth/dto/user.dto";
import { UpdateUserProfileDto } from "./dto/update-user-profile.dto";
import { S3Service } from "@s3/s3.service";

@ApiTags("users")
@ApiExtraModels(UserResponseDto, UserListResponseDto, UserSingleResponseDto, UserProfileResponseDto)
@ApiBearerAuth("JWT-auth")
@Controller("users")
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
  ) {}

  @Get("profile")
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the current user profile",
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  getProfile(@Request() req: RequestWithUser): UserDto {
    return req.user;
  }

  @Patch("profile")
  @ApiOperation({ summary: "Update current user profile" })
  @ApiBody({ type: UpdateUserProfileDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User profile updated successfully",
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Request() req: RequestWithUser,
    @Body(ValidationPipe) updateUserProfileDto: UpdateUserProfileDto,
  ): Promise<UserDto> {    
    this.logger.debug(`Updating profile for user ID: ${req.user.id}`);
    const user = await this.userService.updateProfile(req.user.id, updateUserProfileDto);
    return user;
  }

  @Patch("profile/photo")
  @ApiOperation({ summary: "Update current user profile photo" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Profile image (jpg, png, webp)",
        },
      },
      required: ["file"],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User profile photo updated successfully",
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file"))
  async updateProfilePhoto(
    @Request() req: RequestWithUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({
          maxSize: 5 * 1024 * 1024,
        })
        .addFileTypeValidator({
          fileType: /^image\/(jpeg|png|webp)$/i,
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
      file: Express.Multer.File,
  ): Promise<UserDto> {
    if (!file) {
      throw new BadRequestException("No file provided");
    }

    const extensionMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };

    const extension =
      extensionMap[file.mimetype] || file.originalname.split(".").pop();
    if (!extension) {
      throw new BadRequestException("File has no extension");
    }

    const key = `users/${req.user.id}/profile/profile_picture.${extension}`;
    const metadata = {
      uploadedBy: req.user.id.toString(),
      originalName: file.originalname,
    };

    if (req.user.profileImageUrl) {
      try {
        const existingKey = new URL(req.user.profileImageUrl).pathname.replace(/^\/+/, "");
        if (existingKey) {
          await this.s3Service.deleteFile(existingKey);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete old profile image for user ${req.user.id}: ${error}`);
      }
    }

    await this.s3Service.uploadFile(file, metadata, undefined, key);
    const profileImageUrl = await this.s3Service.getSignedDownloadUrl(key);
    const user = await this.userService.updateProfile(req.user.id, { profileImageUrl });
    return user;
  }

  @Get()
  @ApiOperation({ summary: "Get all users with pagination and filtering" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns paginated list of users",
    type: UserListResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiQuery({ type: UserFilterDto })
  @UseGuards(JwtAuthGuard)
  async findAll(@Query() filterDto: UserFilterDto): Promise<{statusCode: number, message: string, data: UserDto[], meta: { page: number, limit: number, total: number, totalPages: number} }>{
    const {
      page = 1,
      limit = 10,
      nickname,
      email,
      sortBy,
      order,
    } = filterDto;

    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;

    this.logger.debug(
      `Fetching users with pagination: ${JSON.stringify(filterDto)}`,
    );

    const skip = (pageNumber - 1) * limitNumber;
    const filter: Prisma.UserWhereInput = {};

    if (nickname) filter.nickname = { contains: nickname };
    if (email) filter.email = { contains: email };

    const orderBy: Prisma.UserOrderByWithRelationInput & {[id: string]: string} = {};
    if (sortBy) {
      orderBy[sortBy] = order || "asc";
    } else {
      orderBy.id = "asc";
    }

    const [users, total] = await Promise.all([
      this.userService.findAll({
        skip,
        take: limitNumber,
        where: Object.keys(filter).length ? filter : {},
        orderBy,
      }),
      this.userService.count(filter),
    ]);

    return {
      statusCode: HttpStatus.OK,
      message: "Users retrieved successfully",
      data: users,
      meta: {
        page: +pageNumber,
        limit: +limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a user by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the user",
    type: UserSingleResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid ID format",
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  async findOne(@Param("id", ParseIntPipe) id: number): Promise<{ statusCode: number, message: string, data: UserDto }> {
    this.logger.debug(`Fetching user with ID: ${id}`);
    const user = await this.userService.findOne(id);

    return {
      statusCode: HttpStatus.OK,
      message: "User retrieved successfully",
      data: user,
    };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a user by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User updated successfully",
    type: UserSingleResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Invalid input" })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: "Insufficient permissions" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("Admin")
  async update(@Param("id", ParseIntPipe) id: number, @Body(ValidationPipe) updateUserDto: UpdateUserDto): Promise<{statusCode: number, message: string, data: UserDto}> {
    this.logger.debug(`Updating user with ID: ${id}`);
    const user = await this.userService.update(id, updateUserDto);

    return {
      statusCode: HttpStatus.OK,
      message: "User updated successfully",
      data: user,
    };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a user by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User deleted successfully",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 200 },
        message: { type: "string", example: "User deleted successfully" }
      }
    }
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions",
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("Admin")
  async remove(@Param("id", ParseIntPipe) id: number): Promise<{ statusCode: number, message: string }> {
    this.logger.debug(`Deleting user with ID: ${id}`);
    await this.userService.remove(id);

    return {
      statusCode: HttpStatus.OK,
      message: "User deleted successfully",
    };
  }
}
