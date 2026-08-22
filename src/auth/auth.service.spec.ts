import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { UserService } from "@user/user.service";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { Prisma, User } from "@prisma/client";
import { GoogleAuthService } from "./providers/google-auth.service";
import { GithubAuthService } from "./providers/github-auth.service";
import { MicrosoftAuthService } from "./providers/microsoft-auth.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue("hashed_value")
}));

const configServiceValue = {
  get: jest.fn((key: string) => {
    if (key === "JWT_SECRET") return "test-secret-key";
    if (key === "JWT_EXPIRES_IN") return "1h";
    if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
    return undefined;
  })
};

type RefreshTokenMock = {
  create: jest.Mock;
  deleteMany: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  delete: jest.Mock;
};

type TransactionClientMock = {
  refreshToken: Pick<RefreshTokenMock, "create" | "deleteMany" | "delete">;
};

type PrismaServiceMock = {
  $transaction: jest.Mock;
  refreshToken: RefreshTokenMock;
};

function makeRefreshTokenMock(
  overrides: Record<string, jest.Mock> = {}
): RefreshTokenMock {
  return {
    create: jest.fn().mockResolvedValue({
      id: 1,
      token: "hashed",
      userId: 1,
      expiresAt: new Date()
    }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue({ id: 1 }),
    ...overrides
  };
}

function makePrisma(
  refreshTokenOverrides: Record<string, jest.Mock> = {}
): PrismaServiceMock {
  return {
    $transaction: jest.fn((cb: (tx: TransactionClientMock) => unknown) =>
      cb({
        refreshToken: {
          create: jest.fn().mockResolvedValue({
            id: 2,
            token: "hashed",
            userId: 1,
            expiresAt: new Date()
          }),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          delete: jest.fn().mockResolvedValue({ id: 1 })
        }
      })
    ),
    refreshToken: makeRefreshTokenMock(refreshTokenOverrides)
  };
}

describe("AuthService", () => {
  let authService: AuthService;

  const userRecord = <T extends object>(user: T): T & Pick<
    User,
    | "description"
    | "accountStatus"
    | "moderationReason"
    | "moderatedAt"
    | "moderatedById"
  > => ({
      description: null,
      accountStatus: "ACTIVE",
      moderationReason: null,
      moderatedAt: null,
      moderatedById: null,
      ...user
    });

  const userService: jest.Mocked<
    Pick<UserService, "findByEmail" | "findAll" | "create" | "createOAuthUser">
  > = {
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    createOAuthUser: jest.fn()
  };

  const jwtService: jest.Mocked<
    Pick<JwtService, "sign" | "decode" | "verify">
  > = {
    sign: jest.fn().mockReturnValue("token123"),
    decode: jest.fn().mockReturnValue({ sub: 1, email: "test@test.com" }),
    verify: jest.fn().mockReturnValue({ sub: 1, email: "test@test.com" })
  };

  const prismaService = makePrisma();

  async function buildModule(
    prisma: PrismaServiceMock = prismaService,
    googleAuth: unknown = {}
  ): Promise<AuthService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: GoogleAuthService, useValue: googleAuth },
        { provide: GithubAuthService, useValue: {} },
        { provide: MicrosoftAuthService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configServiceValue }
      ]
    }).compile();
    return module.get<AuthService>(AuthService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    (jwtService.sign as jest.Mock).mockReturnValue("token123");
    (jwtService.decode as jest.Mock).mockReturnValue({
      sub: 1,
      email: "test@test.com"
    });
    (jwtService.verify as jest.Mock).mockReturnValue({
      sub: 1,
      email: "test@test.com"
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed_value");

    authService = await buildModule();
  });

  it("should be defined", () => {
    expect(authService).toBeDefined();
  });

  describe("validateUser", () => {
    it("should throw UnauthorizedException if user not found", async () => {
      userService.findByEmail.mockResolvedValue(undefined);
      await expect(
        authService.validateUser("test@example.com", "password")
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException if password is invalid", async () => {
      userService.findByEmail.mockResolvedValue(userRecord({
        id: 1,
        email: "test@example.com",
        username: "testuser",
        nickname: null,
        description: null,
        password: "hashedPass",
        createdAt: new Date()
      }));

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      await expect(
        authService.validateUser("test@example.com", "wrongpass")
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should return user if email and password are valid", async () => {
      const mockUser = userRecord({
        id: 1,
        email: "test@example.com",
        password: "hashedPass",
        username: "testuser",
        nickname: null,
        description: null,
        createdAt: new Date()
      });
      userService.findByEmail.mockResolvedValue(mockUser);
      const result = await authService.validateUser(
        "test@example.com",
        "password"
      );
      expect(result).toEqual(mockUser);
    });
  });

  describe("login", () => {
    it("should return access token if credentials are valid", async () => {
      const mockUser = userRecord({
        id: 1,
        email: "test@example.com",
        password: "hashedPass",
        username: "testuser",
        nickname: null,
        description: null,
        createdAt: new Date()
      });

      jest.spyOn(authService, "validateUser").mockResolvedValue(mockUser);

      const result = await authService.login("test@example.com", "password");
      expect(result).toEqual({
        access_token: "token123",
        refresh_token: "token123"
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: mockUser.id, email: mockUser.email, scope: "user" },
        expect.any(Object)
      );
    });
  });

  describe("register", () => {
    it("should throw ConflictException if email already exists", async () => {
      userService.findAll.mockImplementation(
        async (params?: Prisma.UserFindManyArgs): Promise<User[]> => {
          const where = params?.where || {};
          let emailFilter: string | undefined;
          if (where.email) {
            if (typeof where.email === "string") emailFilter = where.email;
            else if (
              "equals" in where.email &&
              typeof where.email.equals === "string"
            )
              emailFilter = where.email.equals;
          }
          if (emailFilter === "exists@example.com") {
            return [
              userRecord({
                id: 1,
                email: emailFilter,
                username: "user",
                nickname: null,
                description: null,
                password: "hashedPass",
                createdAt: new Date()
              })
            ];
          }
          return [];
        }
      );

      await expect(
        authService.register({
          email: "exists@example.com",
          username: "user",
          password: "pass",
          roles: []
        })
      ).rejects.toThrow(ConflictException);
    });

    it("should throw ConflictException if username already exists", async () => {
      userService.findAll.mockImplementation(
        async (params?: Prisma.UserFindManyArgs): Promise<User[]> => {
          const where = params?.where || {};
          let usernameFilter: string | undefined;
          if (where.username) {
            if (typeof where.username === "string")
              usernameFilter = where.username;
            else if (
              "equals" in where.username &&
              typeof where.username.equals === "string"
            )
              usernameFilter = where.username.equals;
          }
          if (usernameFilter === "existsUser") {
            return [
              userRecord({
                id: 2,
                email: "user@example.com",
                username: usernameFilter,
                nickname: null,
                description: null,
                password: "hashedPass",
                createdAt: new Date()
              })
            ];
          }
          return [];
        }
      );

      await expect(
        authService.register({
          email: "new@example.com",
          username: "existsUser",
          password: "pass",
          roles: []
        })
      ).rejects.toThrow(ConflictException);
    });

    it("should create user and return access token", async () => {
      userService.findAll.mockResolvedValue([]);
      userService.create.mockResolvedValue(userRecord({
        id: 1,
        email: "new@example.com",
        username: "newUser",
        nickname: null,
        description: null,
        password: "hashedPassword",
        createdAt: new Date()
      }));

      const result = await authService.register({
        email: "new@example.com",
        username: "newUser",
        password: "pass",
        roles: []
      });

      expect(userService.create).toHaveBeenCalled();
      expect(result).toEqual({ access_token: "token123", refresh_token: "token123" });
    });
  });

  describe("loginWithGoogleCode", () => {
    it("should create new user and return tokens for new Google user", async () => {
      const googleUser = {
        email: "google@example.com",
        name: "Google User"
      };

      const googleAuthService = {
        getUserFromCode: jest.fn().mockResolvedValue(googleUser)
      };

      userService.findByEmail.mockResolvedValue(undefined);
      userService.findAll.mockResolvedValue([]);

      const newUser = userRecord({
        id: 5,
        email: googleUser.email,
        username: "Google_User",
        nickname: null,
        password: null,
        createdAt: new Date()
      });
      userService.createOAuthUser.mockResolvedValue(newUser);
      jwtService.sign.mockReturnValue("google-token-abc");

      const testAuthService = await buildModule(prismaService, googleAuthService);

      const result = await testAuthService.loginWithGoogleCode(
        "google-code",
        "google-verifier"
      );

      expect(googleAuthService.getUserFromCode).toHaveBeenCalledWith(
        "google-code",
        "google-verifier"
      );
      expect(userService.createOAuthUser).toHaveBeenCalledWith(
        googleUser.email,
        "Google_User"
      );
      expect(result).toEqual({
        access_token: "google-token-abc",
        refresh_token: "google-token-abc"
      });
    });

    it("should return tokens for existing Google user", async () => {
      const googleUser = {
        email: "existing@example.com",
        name: "Existing User"
      };

      const existingUser = userRecord({
        id: 6,
        email: googleUser.email,
        username: "existing_user",
        nickname: null,
        password: "somepass",
        createdAt: new Date()
      });

      const googleAuthService = {
        getUserFromCode: jest.fn().mockResolvedValue(googleUser)
      };

      userService.findByEmail.mockResolvedValue(existingUser);
      jwtService.sign.mockReturnValue("existing-token-xyz");

      const testAuthService = await buildModule(prismaService, googleAuthService);

      const result = await testAuthService.loginWithGoogleCode(
        "google-code",
        "google-verifier"
      );

      expect(googleAuthService.getUserFromCode).toHaveBeenCalledWith(
        "google-code",
        "google-verifier"
      );
      expect(userService.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        access_token: "existing-token-xyz",
        refresh_token: "existing-token-xyz"
      });
    });
  });

  describe("refreshToken", () => {
    it("should throw UnauthorizedException if refresh token not found", async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 1,
        email: "test@test.com"
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const prisma = makePrisma({ findMany: jest.fn().mockResolvedValue([]) });
      const svc = await buildModule(prisma);

      await expect(svc.refreshToken("invalid-token")).rejects.toThrow(
        UnauthorizedException
      );
    });

    it("should throw UnauthorizedException if refresh token expired", async () => {
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60);
      const tokenRecord = {
        id: 1,
        token: "hashed-expired",
        userId: 1,
        expiresAt: expiredDate,
        user: {
          id: 1,
          email: "user@example.com",
          username: "user",
          nickname: null,
          password: "pass",
          createdAt: new Date()
        }
      };

      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 1,
        email: "user@example.com"
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const deleteOne = jest.fn().mockResolvedValue({ id: 1 });
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue([tokenRecord]),
        delete: deleteOne
      });
      const svc = await buildModule(prisma);

      await expect(svc.refreshToken("expired-token")).rejects.toThrow(
        UnauthorizedException
      );
      expect(deleteOne).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it("should return new tokens for valid refresh token", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const tokenRecord = {
        id: 1,
        token: "hashed-valid",
        userId: 1,
        expiresAt: futureDate,
        user: {
          id: 1,
          email: "user@example.com",
          username: "user",
          nickname: null,
          password: "pass",
          createdAt: new Date()
        }
      };

      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 1,
        email: "user@example.com"
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue("new-access-token");

      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue([tokenRecord])
      });
      const svc = await buildModule(prisma);

      const result = await svc.refreshToken("valid-token");
      expect(result).toEqual({
        access_token: "new-access-token",
        refresh_token: "new-access-token"
      });
    });
  });

  describe("token scope", () => {
    // Admin cookies and API bearer tokens are signed with the same secret, so
    // the scope claim is the only thing keeping them from being interchangeable.

    it("stamps scope \"user\" on regular tokens", async () => {
      (jwtService.sign as jest.Mock).mockReturnValue("signed");
      const svc = await buildModule();

      await svc.generateTokens({ sub: 7, email: "a@b.c" }, 7);

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 7, email: "a@b.c", scope: "user" },
        expect.any(Object)
      );
    });

    it("stamps scope \"admin\" on admin tokens", async () => {
      (jwtService.sign as jest.Mock).mockReturnValue("signed");
      const svc = await buildModule();

      await svc.generateAdminTokens({ sub: 7, email: "a@b.c" }, 7);

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 7, email: "a@b.c", scope: "admin" },
        expect.any(Object)
      );
    });

    it("hashes the admin refresh token before storing it", async () => {
      (jwtService.sign as jest.Mock).mockReturnValue("admin-refresh");
      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed_value");
      const prisma = makePrisma();
      const svc = await buildModule(prisma);

      await svc.generateAdminTokens({ sub: 7, email: "a@b.c" }, 7);

      // Stored plaintext would never match the bcrypt.compare in rotation,
      // which silently broke every admin refresh.
      expect(bcrypt.hash).toHaveBeenCalledWith("admin-refresh", 10);
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ token: "hashed_value", userId: 7 })
      });
    });

    it("returns cookie max-ages that match the admin token TTLs", async () => {
      (jwtService.sign as jest.Mock).mockReturnValue("signed");
      const svc = await buildModule();

      const tokens = await svc.generateAdminTokens(
        { sub: 7, email: "a@b.c" },
        7
      );

      expect(tokens.access_token_max_age_ms).toBe(30 * 60 * 1000);
      expect(tokens.refresh_token_max_age_ms).toBe(8 * 60 * 60 * 1000);
    });
  });

  describe("refreshAdminTokens", () => {
    const storedToken = (): Record<string, unknown> => ({
      id: 1,
      token: "hashed-valid",
      userId: 1,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: {
        id: 1,
        email: "staff@example.com",
        username: "staff",
        nickname: null,
        password: "pass",
        createdAt: new Date()
      }
    });

    it("rejects an API refresh token presented to the admin flow", async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 1,
        email: "staff@example.com",
        scope: "user"
      });
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue([storedToken()])
      });
      const svc = await buildModule(prisma);

      await expect(svc.refreshAdminTokens("user-token")).rejects.toThrow(
        UnauthorizedException
      );
      // Rejected on the claim alone -- the DB is never consulted.
      expect(prisma.refreshToken.findMany).not.toHaveBeenCalled();
    });

    it("rejects an admin refresh token presented to the API flow", async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 1,
        email: "staff@example.com",
        scope: "admin"
      });
      const svc = await buildModule();

      await expect(svc.refreshToken("admin-token")).rejects.toThrow(
        UnauthorizedException
      );
    });

    it("treats a token minted before the scope claim existed as a user token", async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 1,
        email: "staff@example.com"
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue("new-token");
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue([storedToken()])
      });
      const svc = await buildModule(prisma);

      await expect(svc.refreshToken("legacy-token")).resolves.toEqual({
        access_token: "new-token",
        refresh_token: "new-token"
      });
      await expect(svc.refreshAdminTokens("legacy-token")).rejects.toThrow(
        UnauthorizedException
      );
    });

    it("rotates and returns the user id so the controller need not decode the JWT", async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 1,
        email: "staff@example.com",
        scope: "admin"
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue("rotated");
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue([storedToken()])
      });
      const svc = await buildModule(prisma);

      const result = await svc.refreshAdminTokens("admin-refresh");

      expect(result).toEqual({
        access_token: "rotated",
        refresh_token: "rotated",
        access_token_max_age_ms: 30 * 60 * 1000,
        refresh_token_max_age_ms: 8 * 60 * 60 * 1000,
        userId: 1
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 1, email: "staff@example.com", scope: "admin" },
        expect.any(Object)
      );
    });
  });

  describe("revokeRefreshToken", () => {
    it("should delete refresh token", async () => {
      const tokenRecord = { id: 1, token: "hashed-token", userId: 1 };

      (jwtService.decode as jest.Mock).mockReturnValue({
        sub: 1,
        email: "test@test.com"
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const deleteOne = jest.fn().mockResolvedValue({ id: 1 });
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue([tokenRecord]),
        delete: deleteOne
      });
      const svc = await buildModule(prisma);

      await svc.revokeRefreshToken("token-to-revoke");

      expect(deleteOne).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  describe("validateUser edge cases", () => {
    it("should throw UnauthorizedException if user has no password", async () => {
      const mockUser = userRecord({
        id: 1,
        email: "google@example.com",
        username: "googleuser",
        nickname: null,
        password: null,
        createdAt: new Date()
      });
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.validateUser("google@example.com", "password")
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
