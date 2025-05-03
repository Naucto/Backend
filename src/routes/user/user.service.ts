import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from "../../prisma/prisma.service";
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

      return this.prisma.user.create({
        data: {
          email: createUserDto.email,
          username: createUserDto.username,
          firstName: createUserDto.firstName,
          lastName: createUserDto.lastName,
          password: hashedPassword,
        },
      });
    } catch (error) {
      throw error;
    }
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    // where?: Prisma.UserWhereInput;
    // orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<User[]> {
    try {
      return this.prisma.user.findMany({
        skip: params?.skip,
        take: params?.take,
        // where: params?.where,
        // orderBy: params?.orderBy,
      });
    } catch (error) {
      throw error;
    }
  }

  async count(): Promise<number> {
    try {
      return this.prisma.user.count();
    } catch (error) {
      throw error;
    }
  }

  async findOne(id: number): Promise<User> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      return user;
    } catch (error) {
      throw error;
    }
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    try {
      const data: any = { ...updateUserDto };

      if (updateUserDto.password) {
        data.password = await bcrypt.hash(updateUserDto.password, 10);
      }

      return await this.prisma.user.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: number): Promise<User> {
    try {
      return await this.prisma.user.delete({
        where: { id },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      throw error;
    }
  }
}
