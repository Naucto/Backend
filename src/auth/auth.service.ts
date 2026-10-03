import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Inject
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "@user/user.service";
import { GoogleAuthService } from "./providers/google-auth.service";
import { GithubAuthService } from "./providers/github-auth.service";
import { MicrosoftAuthService } from "./providers/microsoft-auth.service";
import * as bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { UserDto } from "./dto/user.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { JwtPayload } from "./auth.types";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { parseExpiresIn, timespanToMs } from "./auth.utils";
import { v4 as uuidv4 } from "uuid";
import { conflictViolation } from "@common/validation/violation.exception";

/**
 * The form a refresh token is stored and looked up in. A plain digest: the token is already
 * high-entropy, and bcrypt reads only the first 72 bytes of its input, which every token of one
 * user shares.
 */
function storedFormOf(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

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

  getRefreshTokenMaxAgeMs(): number {
    return timespanToMs(
      parseExpiresIn(
        "JWT_REFRESH_EXPIRES_IN",
        this.configService.get<string>("JWT_REFRESH_EXPIRES_IN"),
        "7d"
      )
    );
  }

  private async generateTokens(
    user: { id: number; email: string },
    db: Prisma.TransactionClient = this.prisma
  ): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessTokenExpiresIn = parseExpiresIn(
      "JWT_EXPIRES_IN",
      this.configService.get<string>("JWT_EXPIRES_IN"),
      "1h"
    );
    const refreshTokenExpiresIn = parseExpiresIn(
      "JWT_REFRESH_EXPIRES_IN",
      this.configService.get<string>("JWT_REFRESH_EXPIRES_IN"),
      "7d"
    );

    const access_token = this.jwtService.sign(payload, {
      expiresIn: accessTokenExpiresIn
    });

    // The id keeps two tokens signed for one user within the same second from being identical,
    // which the unique stored form could not hold.
    const refresh_token = this.jwtService.sign(payload, {
      expiresIn: refreshTokenExpiresIn,
      jwtid: uuidv4()
    });

    await db.refreshToken.create({
      data: {
        token: storedFormOf(refresh_token),
        userId: user.id,
        expiresAt: new Date(Date.now() + timespanToMs(refreshTokenExpiresIn))
      }
    });

    return { access_token, refresh_token };
  }

  private replaceSessions(user: { id: number; email: string }): Promise<AuthResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });

      return this.generateTokens(user, tx);
    });
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

    return this.replaceSessions(user);
  }

  async register(createUserDto: CreateUserDto): Promise<AuthResponseDto> {
    const [existingByEmail, existingByUsername] = await Promise.all([
      this.userService.findAll({ where: { email: createUserDto.email } }),
      this.userService.findAll({ where: { username: createUserDto.username } })
    ]);

    if (existingByEmail.length > 0) {
      throw conflictViolation("Email already in use", "email", "EMAIL_TAKEN");
    }

    if (existingByUsername.length > 0) {
      throw conflictViolation("Username already in use", "username", "USERNAME_TAKEN");
    }

    createUserDto.roles = [];

    const newUser = await this.userService.create(createUserDto);

    return this.generateTokens(newUser);
  }

  private async loginWithOAuth(
    email: string,
    name: string
  ): Promise<AuthResponseDto> {
    let user = await this.userService.findByEmail(email);

    if (!user) {
      // A provider's display name is free text, while a handle has to pass the rule a profile
      // edit enforces, with room left for the suffix that tells two of them apart.
      const handle = name
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(0, 18);
      let safeUsername = handle.length < 3 ? "user" : handle;
      const existingUser = await this.userService.findAll({
        where: { username: safeUsername }
      });

      if (existingUser.length > 0) {
        safeUsername = `${safeUsername}_${uuidv4().substring(0, 5)}`;
      }

      user = await this.userService.createOAuthUser(email, safeUsername);
    }

    return this.generateTokens(user);
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
    try {
      this.jwtService.verify(oldToken);
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: storedFormOf(oldToken) },
      select: {
        id: true,
        expiresAt: true,
        user: { select: { id: true, email: true } }
      }
    });

    if (!storedToken) {
      throw new UnauthorizedException("Refresh token not recognized");
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException("Refresh token expired");
    }

    return this.prisma.$transaction(async (tx) => {
      // Two requests may present the same token at once; only the one that removes the row
      // may be issued its replacement.
      const { count } = await tx.refreshToken.deleteMany({
        where: { id: storedToken.id }
      });
      if (count === 0) {
        throw new UnauthorizedException("Refresh token not recognized");
      }

      return this.generateTokens(storedToken.user, tx);
    });
  }

  /** Ends every session of the user: each tab or device holding a refresh token is signed out. */
  async revokeAllRefreshTokens(userId: number): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  /**
   * Sessions opened under the previous password end with it; the pair returned is the caller's
   * way to stay signed in.
   */
  async changePassword(
    userId: number,
    newPassword: string,
    currentPassword?: string
  ): Promise<AuthResponseDto> {
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

    return this.prisma.$transaction(async (tx) => {
      await this.userService.updatePassword(userId, newPassword, tx);
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });

      return this.generateTokens(user, tx);
    });
  }
}
