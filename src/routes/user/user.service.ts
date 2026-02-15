import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { User } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { Role } from "@prisma/client";
import { UpdateUserProfileDto } from "./dto/update-user-profile.dto";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "@s3/cloudfront.service";
import { BadRequestException } from "@nestjs/common";
import { getFileExtension } from "utils/file-utils";

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly cloudfrontService: CloudfrontService,
  ) {}
  private static readonly BCRYPT_SALT_ROUNDS = 10;

  async findRolesByNames(names: string[]): Promise<Role[]> {
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
    const hashedPassword = await bcrypt.hash(createUserDto.password, UserService.BCRYPT_SALT_ROUNDS);

    const rolesToAssign: { id: number }[] = [];

    return this.prisma.user.create({
      data: {
        email: createUserDto.email,
        username: createUserDto.username,
        nickname: createUserDto.nickname ?? null,
        description: createUserDto.description ?? null,
        profileImageUrl: createUserDto.profileImageUrl ?? null,
        password: hashedPassword,
        roles: {
          connect: rolesToAssign
        }
      }
    });
  }

  async findAll(params?: {skip?: number, take?: number, where?: Prisma.UserWhereInput, orderBy?: Prisma.UserOrderByWithRelationInput }): Promise<User[]> {
    const query: Prisma.UserFindManyArgs = {};
    if (params?.skip !== undefined) query.skip = params.skip;
    if (params?.take !== undefined) query.take = params.take;
    if (params?.where !== undefined) query.where = params.where;
    if (params?.orderBy !== undefined) query.orderBy = params.orderBy;

    return this.prisma.user.findMany(query);
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
    const { roles, ...rest } = updateUserDto;
    
    const data: Prisma.UserUpdateInput = {
      ...rest,
      ...(roles ? { roles: { connect: roles.map(roleName => ({ name: roleName })) } } : {}),
    };

    if (updateUserDto.password) {
      data.password = await bcrypt.hash(updateUserDto.password, UserService.BCRYPT_SALT_ROUNDS);
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data,
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
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
    const user = await this.prisma.user.findUnique({
      where: { email }
    });
    return user ?? undefined;
  }

  async updateProfile(id: number, profileData: UpdateUserProfileDto): Promise<User> {    
    try {
      return await this.prisma.user.update({
        where: { id },
        data: profileData,
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      throw error;
    }
  }

  async updateProfilePhoto(userId: number, file: Express.Multer.File): Promise<User> {
    const extension = getFileExtension(file);
    if (!extension) {
      throw new BadRequestException("File has no extension");
    }

    const user = await this.findOne(userId);
    const key = `public/users/${userId}/profile/profile_picture.${extension}`;
    const metadata = {
      uploadedBy: userId.toString(),
      originalName: file.originalname,
    };

    if (user.profileImageUrl) {
      try {
        const existingKey = new URL(user.profileImageUrl).pathname.replace(/^\/+/, "");
        if (existingKey) {
          await this.s3Service.deleteFile(existingKey);
        }
      } catch {
        // Best-effort cleanup only.
      }
    }

    await this.s3Service.uploadFile(file, metadata, undefined, key);
    const profileImageUrl = this.cloudfrontService.getCDNUrl(key);
    return this.updateProfile(userId, { profileImageUrl });
  }
}
