import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
  BadRequestException,
  Inject
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "@user/user.service";
import { GoogleAuthService } from "./providers/google-auth.service";
import { GithubAuthService } from "./providers/github-auth.service";
import { MicrosoftAuthService } from "./providers/microsoft-auth.service";
import * as bcrypt from "bcryptjs";
import { UserDto } from "./dto/user.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { JwtPayload } from "./auth.types";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { parseExpiresIn, timespanToMs } from "./auth.utils";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly githubAuthService: GithubAuthService,
    private readonly microsoftAuthService: MicrosoftAuthService,
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly configService: ConfigService
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

    const hashedRefreshToken = await bcrypt.hash(refresh_token, 10);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
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

  private async loginWithOAuth(
    email: string,
    name: string
  ): Promise<AuthResponseDto> {
    let user = await this.userService.findByEmail(email);

    if (!user) {
      let safeUsername = name.replace(/\s+/g, "_");
      const existingUser = await this.userService.findAll({
        where: { username: safeUsername }
      });

      if (existingUser.length > 0) {
        safeUsername = `${safeUsername}_${uuidv4().substring(0, 5)}`;
      }

      user = await this.userService.createOAuthUser(email, safeUsername);
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const { access_token, refresh_token } = await this.generateTokens(
      payload,
      user.id
    );

    return { access_token, refresh_token };
  }

  async loginWithGoogle(token: string): Promise<AuthResponseDto> {
    const { email, name } = await this.googleAuthService.verifyToken(token);
    return this.loginWithOAuth(email, name);
  }

  async loginWithGoogleCode(code: string, codeVerifier: string): Promise<AuthResponseDto> {
    const { email, name } = await this.googleAuthService.getUserFromCode(code, codeVerifier);
    return this.loginWithOAuth(email, name);
  }

  async loginWithGithub(code: string): Promise<AuthResponseDto> {
    const { email, name } = await this.githubAuthService.getUserFromCode(code);
    return this.loginWithOAuth(email, name);
  }

  async loginWithMicrosoft(idToken: string): Promise<AuthResponseDto> {
    const { email, name } = await this.microsoftAuthService.verifyToken(idToken);
    return this.loginWithOAuth(email, name);
  }

  async refreshToken(oldToken: string): Promise<AuthResponseDto> {
    let payload: JwtPayload;
    const jwtSecret = this.configService.get<string>("JWT_SECRET");

    if (!jwtSecret) {
      throw new InternalServerErrorException("JWT_SECRET is not defined");
    }

    try {
      payload = this.jwtService.verify(oldToken, {
        secret: jwtSecret
      });
    } catch (e) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const userTokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub },
      include: { user: true }
    });

    let storedToken = null;
    for (const tokenRecord of userTokens) {
      if (await bcrypt.compare(oldToken, tokenRecord.token)) {
        storedToken = tokenRecord;
        break;
      }
    }

    if (!storedToken) {
      throw new UnauthorizedException("Refresh token not recognized");
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException("Refresh token expired");
    }

    return this.prisma.$transaction(async (tx) => {
      const newPayload: JwtPayload = {
        sub: storedToken.user.id,
        email: storedToken.user.email
      };
      const { access_token, refresh_token } = await this.generateTokens(
        newPayload,
        storedToken.user.id
      );

      await tx.refreshToken.delete({ where: { id: storedToken.id } });

      return { access_token, refresh_token };
    });
  }

  async revokeRefreshToken(token: string): Promise<void> {
    try {
      const decoded = this.jwtService.decode(token) as JwtPayload;
      if (!decoded || !decoded.sub) return;

      const userTokens = await this.prisma.refreshToken.findMany({
        where: { userId: decoded.sub }
      });

      for (const tokenRecord of userTokens) {
        if (await bcrypt.compare(token, tokenRecord.token)) {
          await this.prisma.refreshToken.delete({
            where: { id: tokenRecord.id }
          });
          break;
        }
      }
    } catch (error) {
      console.error("Error revoking token:", error);
    }
  }

  async changePassword(
    userId: number,
    newPassword: string,
    currentPassword?: string
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    if (user.password) {
      if (!currentPassword) {
        throw new BadRequestException("Current password is required");
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        throw new UnauthorizedException("Current password is incorrect");
      }
    }

    await this.userService.updatePassword(userId, newPassword);
  }
}
