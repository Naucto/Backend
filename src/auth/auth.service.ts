import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { conflictViolation } from '../common/validation/violation.exception';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from '../routes/user/dto/create-user.dto';
import { UserService } from '../routes/user/user.service';
import { JwtPayload } from './auth.types';
import { authLifetimes, timespanToMs } from './auth.utils';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserDto } from './dto/user.dto';
import { HANDLE_FORBIDDEN_RUN, HANDLE_MAX, HANDLE_MIN } from './handle-policy';
import { GithubAuthService } from './providers/github-auth.service';
import { GoogleAuthService, GoogleCredential } from './providers/google-auth.service';
import { MicrosoftAuthService } from './providers/microsoft-auth.service';
import { OAuthProviderService } from './providers/oauth-provider.base';

/** What each sign-in provider takes from the browser, by the name the routes dispatch on. */
interface OAuthCredentials {
  google: GoogleCredential;
  github: string;
  microsoft: string;
}

export type OAuthProviderName = keyof OAuthCredentials;

/** Random characters appended, after an underscore, to a minted handle someone already holds. */
const HANDLE_SUFFIX_RANDOM_LENGTH = 5;

/**
 * The form a refresh token is stored and looked up in. A plain digest: the token is already
 * high-entropy, and bcrypt reads only the first 72 bytes of its input, which every token of one
 * user shares.
 */
function storedFormOf(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly oauthProviders: {
    [P in OAuthProviderName]: OAuthProviderService<OAuthCredentials[P]>;
  };

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    googleAuthService: GoogleAuthService,
    githubAuthService: GithubAuthService,
    microsoftAuthService: MicrosoftAuthService,
    private readonly prisma: PrismaService,
  ) {
    this.oauthProviders = {
      google: googleAuthService,
      github: githubAuthService,
      microsoft: microsoftAuthService,
    };
  }

  getRefreshTokenMaxAgeMs(): number {
    return timespanToMs(authLifetimes().refreshToken);
  }

  private async generateTokens(
    user: { id: number; email: string },
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const lifetimes = authLifetimes();

    const access_token = this.jwtService.sign(payload, {
      expiresIn: lifetimes.accessToken,
    });

    // The id keeps two tokens signed for one user within the same second from being identical,
    // which the unique stored form could not hold.
    const refresh_token = this.jwtService.sign(payload, {
      expiresIn: lifetimes.refreshToken,
      jwtid: uuidv4(),
    });

    await db.refreshToken.create({
      data: {
        token: storedFormOf(refresh_token),
        userId: user.id,
        expiresAt: new Date(Date.now() + timespanToMs(lifetimes.refreshToken)),
      },
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
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.password) {
      throw new UnauthorizedException('This account cannot authenticate with a password.');
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
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
      this.userService.findAll({ where: { username: createUserDto.username } }),
    ]);

    if (existingByEmail.length > 0) {
      throw conflictViolation('Email already in use', 'email', 'EMAIL_TAKEN');
    }

    if (existingByUsername.length > 0) {
      throw conflictViolation('Username already in use', 'username', 'USERNAME_TAKEN');
    }

    const newUser = await this.userService.create(createUserDto);

    return this.generateTokens(newUser);
  }

  /** Signs in whoever the provider vouches for, creating their account on first sign-in. */
  async loginWithProvider<P extends OAuthProviderName>(
    provider: P,
    credential: OAuthCredentials[P],
  ): Promise<AuthResponseDto> {
    const { email, name } = await this.oauthProviders[provider].authenticate(credential);
    let user = await this.userService.findByEmail(email);

    if (!user) {
      // A provider's display name is free text, while a handle has to pass the handle rule, with
      // room left for the suffix that tells two of them apart.
      const handle = name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(HANDLE_FORBIDDEN_RUN, '_')
        .slice(0, HANDLE_MAX - 1 - HANDLE_SUFFIX_RANDOM_LENGTH);
      let safeUsername = handle.length < HANDLE_MIN ? 'user' : handle;
      const existingUser = await this.userService.findAll({
        where: { username: safeUsername },
      });

      if (existingUser.length > 0) {
        safeUsername = `${safeUsername}_${uuidv4().substring(0, HANDLE_SUFFIX_RANDOM_LENGTH)}`;
      }

      user = await this.userService.createOAuthUser(email, safeUsername);
    }

    return this.generateTokens(user);
  }

  async refreshToken(oldToken: string): Promise<AuthResponseDto> {
    try {
      this.jwtService.verify(oldToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: storedFormOf(oldToken) },
      select: {
        id: true,
        expiresAt: true,
        user: { select: { id: true, email: true } },
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token not recognized');
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    return this.prisma.$transaction(async (tx) => {
      // Two requests may present the same token at once; only the one that removes the row
      // may be issued its replacement.
      const { count } = await tx.refreshToken.deleteMany({
        where: { id: storedToken.id },
      });
      if (count === 0) {
        throw new UnauthorizedException('Refresh token not recognized');
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
    currentPassword?: string,
  ): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.password) {
      if (!currentPassword) {
        throw new BadRequestException('Current password is required');
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await this.userService.updatePassword(userId, newPassword, tx);
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });

      return this.generateTokens(user, tx);
    });
  }
}
