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

function makeRefreshTokenMock(overrides: Record<string, jest.Mock> = {}) {
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

function makePrisma(refreshTokenOverrides: Record<string, jest.Mock> = {}) {
  return {
    $transaction: jest.fn((cb: any) =>
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

  async function buildModule(prisma = prismaService, googleAuth = {}) {
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
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: "test@example.com",
        username: "testuser",
        nickname: null,
        description: null,
        password: "hashedPass",
        createdAt: new Date()
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      await expect(
        authService.validateUser("test@example.com", "wrongpass")
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should return user if email and password are valid", async () => {
      const mockUser = {
        id: 1,
        email: "test@example.com",
        password: "hashedPass",
        username: "testuser",
        nickname: null,
        description: null,
        createdAt: new Date()
      };
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
      const mockUser = {
        id: 1,
        email: "test@example.com",
        password: "hashedPass",
        username: "testuser",
        nickname: null,
        description: null,
        createdAt: new Date()
      };
      jest.spyOn(authService, "validateUser").mockResolvedValue(mockUser);

      const result = await authService.login("test@example.com", "password");
      expect(result).toEqual({
        access_token: "token123",
        refresh_token: "token123"
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: mockUser.id, email: mockUser.email },
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
              {
                id: 1,
                email: emailFilter,
                username: "user",
                nickname: null,
                description: null,
                password: "hashedPass",
                createdAt: new Date()
              }
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
              {
                id: 2,
                email: "user@example.com",
                username: usernameFilter,
                nickname: null,
                description: null,
                password: "hashedPass",
                createdAt: new Date()
              }
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
      userService.create.mockResolvedValue({
        id: 1,
        email: "new@example.com",
        username: "newUser",
        nickname: null,
        description: null,
        password: "hashedPassword",
        createdAt: new Date()
      });

      const result = await authService.register({
        email: "new@example.com",
        username: "newUser",
        password: "pass",
        roles: []
      });

      expect(userService.create).toHaveBeenCalled();
      expect(result).toEqual({
        access_token: "token123",
        refresh_token: "token123"
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
      userService.findByEmail.mockResolvedValue({
        id: 1,
        email: "google@example.com",
        username: "googleuser",
        nickname: null,
        password: null,
        createdAt: new Date()
      } as any);

      await expect(
        authService.validateUser("google@example.com", "password")
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
