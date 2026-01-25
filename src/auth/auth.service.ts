import {
  Injectable,
  ConflictException,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "@user/user.service";
import { GoogleAuthService } from "./google-auth.service";
import * as bcrypt from "bcryptjs";
import { UserDto } from "./dto/user.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { JwtPayload } from "./auth.types";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { PrismaService } from "@prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { parseExpiresIn, timespanToMs } from "./auth.utils";

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) {}

  async generateTokens(
    payload: JwtPayload,
    userId: number
  ): Promise<AuthResponseDto> {
    const accessTokenExpiresIn = parseExpiresIn(
      this.configService.get<string>("JWT_EXPIRES_IN"),
      "1h"
    );
    const refreshTokenExpiresIn = parseExpiresIn(
      this.configService.get<string>("JWT_REFRESH_EXPIRES_IN"),
      "7d"
    );

    const access_token = this.jwtService.sign(payload, {
      expiresIn: accessTokenExpiresIn
    });

    const refresh_token = this.jwtService.sign(payload, {
      expiresIn: refreshTokenExpiresIn
    });

    await this.prisma.refreshToken.create({
      data: {
        token: refresh_token,
        userId,
        expiresAt: new Date(Date.now() + timespanToMs(refreshTokenExpiresIn))
      }
    });

    return { access_token, refresh_token };
  }

  async validateUser(email: string, password: string): Promise<UserDto> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!user.password) {
      throw new UnauthorizedException(
        "This account cannot authenticate with a password."
      );
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return user;
  }

  async login(email: string, password: string): Promise<AuthResponseDto> {
    const user = await this.validateUser(email, password);

    return this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });

      const payload: JwtPayload = { sub: user.id, email: user.email };
      const { access_token, refresh_token } = await this.generateTokens(
        payload,
        user.id
      );

      return {
        access_token,
        refresh_token
      };
    });
  }

  async register(createUserDto: CreateUserDto): Promise<AuthResponseDto> {
    const [existingByEmail, existingByUsername] = await Promise.all([
      this.userService.findAll({ where: { email: createUserDto.email } }),
      this.userService.findAll({ where: { username: createUserDto.username } })
    ]);

    if (existingByEmail.length > 0) {
      throw new ConflictException("Email already in use");
    }

    if (existingByUsername.length > 0) {
      throw new ConflictException("Username already in use");
    }

    createUserDto.roles = [];

    const newUser = await this.userService.create(createUserDto);

    const payload = { sub: newUser.id, email: newUser.email };
    const { access_token, refresh_token } = await this.generateTokens(
      payload,
      newUser.id
    );

    const response: AuthResponseDto = {
      access_token: access_token,
      refresh_token: refresh_token
    };

    return response;
  }

  async loginWithGoogle(googleToken: string): Promise<AuthResponseDto> {
    const googleUser =
      await this.googleAuthService.verifyGoogleToken(googleToken);

    let user = await this.userService.findByEmail(googleUser.email);

    if (!user) {
      user = await this.userService.create({
        email: googleUser.email,
        username: googleUser.name.replace(/\s+/g, "_"),
        password: "",
        roles: []
      });
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const { access_token, refresh_token } = await this.generateTokens(
      payload,
      user.id
    );

    return { access_token, refresh_token };
  }

  async refreshToken(oldToken: string): Promise<AuthResponseDto> {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: oldToken },
      include: { user: true }
    });

    if (!storedToken) {
      throw new UnauthorizedException("Refresh token not recognized");
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException("Refresh token expired");
    }

    return this.prisma.$transaction(async (tx) => {
      const payload: JwtPayload = {
        sub: storedToken.user.id,
        email: storedToken.user.email
      };

      const { access_token, refresh_token } = await this.generateTokens(
        payload,
        storedToken.user.id
      );

      await tx.refreshToken.delete({ where: { id: storedToken.id } });

      return { access_token, refresh_token };
    });
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { token } });
  }
}
