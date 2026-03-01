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
  ValidationPipe,
  Logger,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  Res,
  HttpException
} from "@nestjs/common";
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
  ApiConsumes
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
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "@s3/cloudfront.service";
import { ConfigService } from "@nestjs/config";
import { SignedCdnResourceDto } from "@common/dto/signed-cdn-resource.dto";
import { MissingEnvVarError } from "@auth/auth.error";

@ApiTags("users")
@ApiExtraModels(
  UserResponseDto,
  UserListResponseDto,
  UserSingleResponseDto,
  UserProfileResponseDto
)
@ApiBearerAuth("JWT-auth")
@Controller("users")
export class UserController {
  private readonly logger = new Logger(UserController.name);
  private readonly sessionCookieTimeout = 600;

  constructor(
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
    private readonly cloudfrontService: CloudfrontService,
    private readonly configService: ConfigService
  ) {}

  @Get("profile")
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the current user profile",
    type: UserProfileResponseDto
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  getProfile(@Request() req: RequestWithUser): UserDto {
    return req.user;
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
  @ApiResponse({ status: HttpStatus.CREATED, description: "Profile uploaded" })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file"))
  @HttpCode(HttpStatus.CREATED)
  async uploadProfilePicture(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY })
    )
    file: Express.Multer.File,
    @Request() req: RequestWithUser
  ): Promise<{ message: string; id: number }> {
    if (req.user.id !== id) {
      throw new HttpException("Forbidden", HttpStatus.FORBIDDEN);
    }

    const key = `users/${id}/profile`;

    await this.s3Service.uploadFile({
      file,
      keyName: key,
      metadata: {
        uploadedBy: req.user.id.toString(),
        userId: id.toString(),
        originalName: file.originalname
      }
    });

    return { message: "Profile picture uploaded successfully", id };
  }

  @Get(":id/profile-picture")
  @ApiOperation({ summary: "Get signed CDN access to a user's profile picture" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Signed cookies and CDN resource URL",
    type: SignedCdnResourceDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Not found" })
  @UseGuards(JwtAuthGuard)
  async getProfilePicture(
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response
  ): Promise<void> {
    const key = `users/${id}/profile`;
    const exists = await this.s3Service.fileExists(key);
    if (!exists) {
      res.status(HttpStatus.NOT_FOUND).json({ message: "Profile picture not found" });
      return;
    }

    const cdnUrl = this.configService.get<string>("CDN_URL");
    if (!cdnUrl) {
      throw new MissingEnvVarError("CDN_URL");
    }

    const resourceUrl = this.cloudfrontService.getCDNUrl(key);
    const cookies = this.cloudfrontService.createSignedCookies(
      resourceUrl,
      this.sessionCookieTimeout
    );

    const cookieOptions = {
      httpOnly: true,
      secure: true,
      path: "/",
      domain: `.${cdnUrl}`,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 1000
    };

    res.cookie("CloudFront-Expires", cookies["CloudFront-Expires"], cookieOptions);
    res.cookie(
      "CloudFront-Signature",
      cookies["CloudFront-Signature"],
      cookieOptions
    );
    res.cookie(
      "CloudFront-Key-Pair-Id",
      cookies["CloudFront-Key-Pair-Id"],
      cookieOptions
    );
    if (cookies["CloudFront-Policy"]) {
      res.cookie("CloudFront-Policy", cookies["CloudFront-Policy"], cookieOptions);
    }

    res.status(HttpStatus.OK).json({
      resourceUrl,
      cookies
    });
  }

  @Get()
  @ApiOperation({ summary: "Get all users with pagination and filtering" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns paginated list of users",
    type: UserListResponseDto
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: "Unauthorized" })
  @ApiQuery({ type: UserFilterDto })
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query() filterDto: UserFilterDto
  ): Promise<{
    statusCode: number;
    message: string;
    data: UserDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page = 1, limit = 10, nickname, email, sortBy, order } = filterDto;

    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;

    this.logger.debug(
      `Fetching users with pagination: ${JSON.stringify(filterDto)}`
    );

    const skip = (pageNumber - 1) * limitNumber;
    const filter: Prisma.UserWhereInput = {};

    if (nickname) filter.nickname = { contains: nickname };
    if (email) filter.email = { contains: email };

    const orderBy: Prisma.UserOrderByWithRelationInput & {
      [id: string]: string;
    } = {};
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
        orderBy
      }),
      this.userService.count(filter)
    ]);

    return {
      statusCode: HttpStatus.OK,
      message: "Users retrieved successfully",
      data: users,
      meta: {
        page: +pageNumber,
        limit: +limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber)
      }
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
  @UseGuards(JwtAuthGuard)
  async findOne(
    @Param("id", ParseIntPipe) id: number
  ): Promise<{ statusCode: number; message: string; data: UserDto }> {
    this.logger.debug(`Fetching user with ID: ${id}`);
    const user = await this.userService.findOne(id);

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
    @Body(ValidationPipe) updateUserDto: UpdateUserDto
  ): Promise<{ statusCode: number; message: string; data: UserDto }> {
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
    description: "Insufficient permissions"
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("Admin")
  async remove(
    @Param("id", ParseIntPipe) id: number
  ): Promise<{ statusCode: number; message: string }> {
    this.logger.debug(`Deleting user with ID: ${id}`);
    await this.userService.remove(id);

    return {
      statusCode: HttpStatus.OK,
      message: "User deleted successfully"
    };
  }
}
