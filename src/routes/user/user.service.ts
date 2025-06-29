import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { User } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}
  private static readonly BCRYPT_SALT_ROUNDS = 10;

  async findRolesByNames(names: string[]) {
    return this.prisma.role.findMany({
      where: {
        name: { in: names }
      },
    });
  }

  async getUserRoles(userId: number): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user.roles.map(role => role.name);
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      const hashedPassword = await bcrypt.hash(createUserDto.password, UserService.BCRYPT_SALT_ROUNDS);

      const rolesToAssign: { id: number }[] = [];

      return this.prisma.user.create({
        data: {
          email: createUserDto.email,
          username: createUserDto.username,
          nickname: createUserDto.nickname ?? null,
          password: hashedPassword,
          roles: {
            connect: rolesToAssign
          }
        }
      });
    } catch (error) {
      throw error;
    }
  }

  async findAll(params?: {skip?: number, take?: number, where?: Prisma.UserWhereInput, orderBy?: Prisma.UserOrderByWithRelationInput }): Promise<User[]> {
    try {
      const query: Prisma.UserFindManyArgs = {};
      if (params?.skip !== undefined) query.skip = params.skip;
      if (params?.take !== undefined) query.take = params.take;
      if (params?.where !== undefined) query.where = params.where;
      if (params?.orderBy !== undefined) query.orderBy = params.orderBy;

      return this.prisma.user.findMany(query);
    } catch (error) {
      throw error;
    }
  }

  async count(where?: Prisma.UserWhereInput): Promise<number> {
    const countArgs: Prisma.UserCountArgs = {};

    if (where !== undefined) countArgs.where = where;
    return this.prisma.user.count(countArgs);
  }

  async findOne(id: number): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const data: any = {
      ...updateUserDto,
    };
    try {
      if (updateUserDto.password) {
        data.password = await bcrypt.hash(updateUserDto.password, UserService.BCRYPT_SALT_ROUNDS);
      }

      return await this.prisma.user.update({
        where: { id },
        data
      });
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2025") {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: number): Promise<User> {
    return this.prisma.user.delete({
      where: { id }
    });
  }

  async findByEmail(email: string): Promise<User | undefined> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email }
      });
      return user ?? undefined;
    } catch (error) {
      throw error;
    }
  }
}
