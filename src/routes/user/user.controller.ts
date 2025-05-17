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
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiExtraModels,
} from '@nestjs/swagger';
import { Request } from '@nestjs/common';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { Prisma } from '@prisma/client';

@ApiTags('users')
@ApiExtraModels(User)
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@Request() req: any) {
    return req.user;
  }

  @Get()
  @ApiOperation({ summary: 'Get all users with pagination and filtering' })
  @ApiPaginatedResponse(User)
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: 'Filter by name',
  })
  @ApiQuery({
    name: 'email',
    required: false,
    type: String,
    description: 'Filter by email',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['id', 'name', 'email', 'createdAt'],
  })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query() paginationDto: PaginationDto,
    @Query('nickname') nickname?: string,
    @Query('email') email?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    this.logger.debug(
      `Fetching users with pagination: ${JSON.stringify(paginationDto)}`,
    );

    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    const filter: Prisma.UserWhereInput = {};
    if (nickname) filter.nickName = { contains: nickname };
    if (email) filter.email = { contains: email };

    const orderBy: Prisma.UserOrderByWithRelationInput = {};
    if (sortBy) {
      orderBy[sortBy] = order || 'asc';
    } else {
      orderBy.id = 'asc';
    }

    const [users, total] = await Promise.all([
      this.userService.findAll({
        skip,
        take: limit,
        where: Object.keys(filter).length ? filter : undefined,
        orderBy,
      }),
      this.userService.count(filter),
    ]);

    return {
      statusCode: HttpStatus.OK,
      message: 'Users retrieved successfully',
      data: users,
      meta: {
        page: +page,
        limit: +limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the user',
    type: User,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid ID format',
  })
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    this.logger.debug(`Fetching user with ID: ${id}`);
    const user = await this.userService.findOne(id);

    return {
      statusCode: HttpStatus.OK,
      message: 'User retrieved successfully',
      data: user,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User updated successfully',
    type: User,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(ValidationPipe) updateUserDto: UpdateUserDto,
  ) {
    this.logger.debug(`Updating user with ID: ${id}`);
    const user = await this.userService.update(id, updateUserDto);

    return {
      statusCode: HttpStatus.OK,
      message: 'User updated successfully',
      data: user,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User deleted successfully',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin')
  async remove(@Param('id', ParseIntPipe) id: number) {
    this.logger.debug(`Deleting user with ID: ${id}`);
    const user = await this.userService.remove(id);

    return {
      statusCode: HttpStatus.OK,
      message: 'User deleted successfully',
      data: user,
    };
  }
}
