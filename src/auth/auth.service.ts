import { createHash } from "node:crypto";
import { Actor } from "@auth/actor";
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  Optional,
  InternalServerErrorException,
  BadRequestException,
  Inject,
  Logger
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "@user/user.service";
import { GoogleAuthService } from "./providers/google-auth.service";
import { GithubAuthService } from "./providers/github-auth.service";
import { MicrosoftAuthService } from "./providers/microsoft-auth.service";
import * as bcrypt from "bcryptjs";
import { UserDto } from "./dto/user.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { JwtPayload, TokenBundle, TokenScope } from "./auth.types";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { parseExpiresIn, TimeSpan, timespanToMs } from "./auth.utils";
import { AccountStatus, AnalyticsEventType, Prisma, Role } from "@prisma/client";
import { AnalyticsService } from "@analytics/analytics.service";
import { v4 as uuidv4 } from "uuid";

const REFRESH_TOKEN_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly githubAuthService: GithubAuthService,
    private readonly microsoftAuthService: MicrosoftAuthService,
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Optional() private readonly analyticsService?: AnalyticsService
  ) {}

  getRefreshTokenMaxAgeMs(): number {
    return timespanToMs(
      parseExpiresIn(this.configService.get<string>("JWT_REFRESH_EXPIRES_IN"), "7d")
    );
  }

  private getTokenTtls(
    scope: TokenScope
  ): { access: TimeSpan; refresh: TimeSpan } {
    if (scope === "admin") {
      return {
        access: parseExpiresIn(
          this.configService.get<string>("JWT_ADMIN_ACCESS_EXPIRES_IN"),
          "30m"
        ),
        refresh: parseExpiresIn(
          this.configService.get<string>("JWT_ADMIN_REFRESH_EXPIRES_IN"),
          "8h"
        )
      };
    }

    return {
      access: parseExpiresIn(
        this.configService.get<string>("JWT_EXPIRES_IN"),
        "1h"
      ),
      refresh: parseExpiresIn(
        this.configService.get<string>("JWT_REFRESH_EXPIRES_IN"),
        "7d"
      )
    };
  }

  /**
   * The single place a token pair is minted and persisted. Both the user and
   * the admin flow go through it so they cannot drift on scope stamping,
   * refresh-token hashing, or lifetimes.
   */
  private async issueTokens(
    payload: JwtPayload,
    userId: number,
    scope: TokenScope,
    db: Prisma.TransactionClient = this.prisma
  ): Promise<TokenBundle> {
    const ttl = this.getTokenTtls(scope);
    const scopedPayload: JwtPayload = {
      sub: payload.sub,
      email: payload.email,
      scope
    };

    const access_token = this.jwtService.sign({ ...scopedPayload, tokenUse: "access" }, {
      expiresIn: ttl.access
    });
    const refresh_token = this.jwtService.sign({ ...scopedPayload, tokenUse: "refresh", jti: uuidv4() }, {
      expiresIn: ttl.refresh
    });

    await db.refreshToken.create({
      data: {
        token: await bcrypt.hash(this.tokenDigest(refresh_token), REFRESH_TOKEN_SALT_ROUNDS),
        userId,
        expiresAt: new Date(Date.now() + timespanToMs(ttl.refresh))
      }
    });

    return {
      access_token,
      refresh_token,
      access_token_max_age_ms: timespanToMs(ttl.access),
      refresh_token_max_age_ms: timespanToMs(ttl.refresh)
    };
  }

  async generateTokens(
    payload: JwtPayload,
    userId: number
  ): Promise<AuthResponseDto> {
    const { access_token, refresh_token } = await this.issueTokens(
      payload,
      userId,
      "user"
    );

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
    if (user.accountStatus === AccountStatus.BANNED) {
      throw new ForbiddenException("This account has been banned.");
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return user;
  }

  async login(
    email: string,
    password: string,
    scope: TokenScope = "user"
  ): Promise<TokenBundle & { userId: number }> {
    const user = await this.validateUser(email, password);
    if (scope === "admin") await this.requireStaff(user.id);
    const tokens = await this.issueTokens({ sub: user.id, email: user.email }, user.id, scope);
    await this.analyticsService?.record(AnalyticsEventType.LOGIN, { userId: user.id });
    return { ...tokens, userId: user.id };
  }

  private async requireStaff(id: number): Promise<void> {
    const user = await this.userService.findOne<{ roles: Role[] }>(id, { roles: true });
    if (user.accountStatus !== AccountStatus.ACTIVE || !Actor.from(user).isStaff) {
      throw new ForbiddenException("Active staff access required");
    }
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

    await this.analyticsService?.record(AnalyticsEventType.ACCOUNT_CREATED, {
      userId: newUser.id
    });

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
    name: string,
    provider: string
  ): Promise<AuthResponseDto> {
    let user = await this.userService.findByEmail(email);

    if (!user) {
      const usernameSource = name.trim() || email.split("@")[0] || "user";
      const baseUsername =
        usernameSource
          .replace(/\s+/g, "_")
          .replace(/[^\w.-]/g, "")
          .slice(0, 20) || `user_${uuidv4().slice(0, 8)}`;
      const safeUsername =
        baseUsername.length >= 3
          ? baseUsername
          : `user_${uuidv4().slice(0, 8)}`;
      const existingUsers = await this.userService.findAll({
        where: { username: safeUsername }
      });

      user = await this.userService.createOAuthUser(
        email,
        existingUsers.length === 0
          ? safeUsername
          : `${safeUsername.slice(0, 11)}_${uuidv4().slice(0, 8)}`
      );

      await this.analyticsService?.record(AnalyticsEventType.ACCOUNT_CREATED, {
        userId: user.id,
        metadata: { provider }
      });
    } else if (user.accountStatus === AccountStatus.BANNED) {
      throw new ForbiddenException("This account has been banned.");
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const { access_token, refresh_token } = await this.generateTokens(
      payload,
      user.id
    );

    await this.analyticsService?.record(AnalyticsEventType.LOGIN, {
      userId: user.id,
      metadata: { provider }
    });

    return { access_token, refresh_token };
  }

  async loginWithGoogleCode(code: string, codeVerifier: string): Promise<AuthResponseDto> {
    const { email, name } = await this.googleAuthService.getUserFromCode(code, codeVerifier);
    return this.loginWithOAuth(email, name, "google");
  }

  async loginWithGithub(code: string): Promise<AuthResponseDto> {
    const { email, name } = await this.githubAuthService.getUserFromCode(code);
    return this.loginWithOAuth(email, name, "github");
  }

  async loginWithMicrosoft(idToken: string): Promise<AuthResponseDto> {
    const { email, name } = await this.microsoftAuthService.verifyToken(idToken);
    return this.loginWithOAuth(email, name, "microsoft");
  }

  async refreshToken(
    oldToken: string,
    scope: TokenScope = "user"
  ): Promise<TokenBundle & { userId: number }> {
    return this.rotateTokens(oldToken, scope);
  }

  private async rotateTokens(
    oldToken: string,
    expectedScope: TokenScope
  ): Promise<TokenBundle & { userId: number }> {
    let payload: JwtPayload;
    const jwtSecret = this.configService.get<string>("JWT_SECRET");

    if (!jwtSecret) {
      throw new InternalServerErrorException("JWT_SECRET is not defined");
    }

    try {
      payload = this.jwtService.verify(oldToken, {
        secret: jwtSecret
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // Both scopes are signed with the same secret, so without this check an API
    // refresh token could be dropped into the admin cookie to mint admin tokens.
    if ((payload.scope ?? "user") !== expectedScope || payload.tokenUse === "access") {
      throw new UnauthorizedException("Refresh token scope mismatch");
    }

    const userTokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub },
      include: { user: true }
    });

    let storedToken = null;
    for (const tokenRecord of userTokens) {
      if (await bcrypt.compare(payload.tokenUse ? this.tokenDigest(oldToken) : oldToken, tokenRecord.token)) {
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

    const user = storedToken.user;
    if (user.accountStatus === AccountStatus.BANNED) {
      throw new UnauthorizedException("This account has been banned.");
    }
    if (expectedScope === "admin") await this.requireStaff(user.id);
    const consumedTokenId = storedToken.id;

    return this.prisma.$transaction(async (tx) => {
      const tokens = await this.issueTokens(
        { sub: user.id, email: user.email },
        user.id,
        expectedScope,
        tx
      );

      await tx.refreshToken.delete({ where: { id: consumedTokenId } });

      return { ...tokens, userId: user.id };
    });
  }

  private tokenDigest(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async revokeRefreshToken(token: string): Promise<void> {
    try {
      const decoded = this.jwtService.decode(token) as JwtPayload;
      if (!decoded || !decoded.sub) return;

      const userTokens = await this.prisma.refreshToken.findMany({
        where: { userId: decoded.sub }
      });

      for (const tokenRecord of userTokens) {
        if (await bcrypt.compare(decoded.tokenUse ? this.tokenDigest(token) : token, tokenRecord.token)) {
          await this.prisma.refreshToken.delete({
            where: { id: tokenRecord.id }
          });
          break;
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to revoke refresh token: ${error instanceof Error ? error.message : String(error)}`);
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
