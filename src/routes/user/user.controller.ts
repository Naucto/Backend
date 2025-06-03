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
import { UserFilterDto } from './dto/user-filter.dto';
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { Prisma } from '@prisma/client';
import { UserDto } from 'src/auth/dto/user.dto';

@ApiTags('users')
@ApiExtraModels(UserDto)
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
  @ApiPaginatedResponse(UserDto)
  @ApiQuery({ type: UserFilterDto })
  @UseGuards(JwtAuthGuard)
  async findAll(@Query() filterDto: UserFilterDto) {
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

    const orderBy: Prisma.UserOrderByWithRelationInput = {};
    if (sortBy) {
      (orderBy as any)[sortBy] = order || 'asc';
    } else {
      orderBy.id = 'asc';
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
      message: 'Users retrieved successfully',
      data: users,
      meta: {
        page: +pageNumber,
        limit: +limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the user',
    type: UserDto,
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
    type: UserDto,
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
    await this.userService.remove(id);

    return {
      statusCode: HttpStatus.OK,
      message: 'User deleted successfully',
    };
  }
}
