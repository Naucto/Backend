import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { UserService } from "@user/user.service";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { Prisma, User } from "@prisma/client";
import { GoogleAuthService } from "./google-auth.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";

jest.mock("bcryptjs", () => ({
  compare: jest.fn()
}));

describe("AuthService", () => {
  let authService: AuthService;

  const userService: jest.Mocked<
    Pick<UserService, "findByEmail" | "findAll" | "create">
  > = {
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn()
  };

  const jwtService: jest.Mocked<Pick<JwtService, "sign">> = {
    sign: jest.fn()
  };

  const prismaService = {
    $transaction: jest.fn((callback: any) => {
      // Create a mock transaction client
      const txClient = {
        refreshToken: {
          create: jest.fn().mockResolvedValue({ id: 1, token: "refresh_token123", userId: 1, expiresAt: new Date() }),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 })
        }
      };
      return callback(txClient);
    }),
    refreshToken: {
      create: jest.fn(),
      deleteMany: jest.fn()
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: GoogleAuthService, useValue: {} },
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
          if (key === "JWT_EXPIRES_IN") return "1h";
          if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
          return undefined;
        }) } }
      ]
    }).compile();

    authService = module.get<AuthService>(AuthService);
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
        createdAt: new Date()
      };

      jest.spyOn(authService, "validateUser").mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue("token123");

      const result = await authService.login("test@example.com", "password");
      expect(result).toEqual({ access_token: "token123", refresh_token: "token123" });
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email
      }, expect.any(Object));
    });
  });

  describe("register", () => {
    it("should throw ConflictException if email already exists", async () => {
      userService.findAll.mockImplementation(
        async (params?: Prisma.UserFindManyArgs): Promise<User[]> => {
          const where = params?.where || {};

          let emailFilter: string | undefined;
          if (where.email) {
            if (typeof where.email === "string") {
              emailFilter = where.email;
            } else if (
              "equals" in where.email &&
              typeof where.email.equals === "string"
            ) {
              emailFilter = where.email.equals;
            }
          }

          if (emailFilter === "exists@example.com") {
            return [
              {
                id: 1,
                email: emailFilter,
                username: "user",
                nickname: null,
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
            if (typeof where.username === "string") {
              usernameFilter = where.username;
            } else if (
              "equals" in where.username &&
              typeof where.username.equals === "string"
            ) {
              usernameFilter = where.username.equals;
            }
          }

          if (usernameFilter === "existsUser") {
            return [
              {
                id: 2,
                email: "user@example.com",
                username: usernameFilter,
                nickname: null,
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

      const newUser = {
        id: 1,
        email: "new@example.com",
        username: "newUser",
        nickname: null,
        password: "hashedPassword",
        createdAt: new Date()
      };

      userService.create.mockResolvedValue(newUser);
      jwtService.sign.mockReturnValue("token123");

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

  describe("loginWithGoogle", () => {
    it("should create new user and return tokens for new Google user", async () => {
      const googleUser = {
        email: "google@example.com",
        name: "Google User"
      };

      const googleAuthService = {
        verifyGoogleToken: jest.fn().mockResolvedValue(googleUser)
      };

      userService.findByEmail.mockResolvedValue(undefined);

      const newUser = {
        id: 5,
        email: googleUser.email,
        username: "Google_User",
        nickname: null,
        password: "",
        createdAt: new Date()
      };
      userService.create.mockResolvedValue(newUser);
      jwtService.sign.mockReturnValue("google-token-abc");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: UserService, useValue: userService },
          { provide: JwtService, useValue: jwtService },
          { provide: GoogleAuthService, useValue: googleAuthService },
          { provide: PrismaService, useValue: prismaService },
          { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
            if (key === "JWT_EXPIRES_IN") return "1h";
            if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
            return undefined;
          }) } }
        ]
      }).compile();

      const testAuthService = module.get<AuthService>(AuthService);

      const result = await testAuthService.loginWithGoogle("google-oauth-token");

      expect(googleAuthService.verifyGoogleToken).toHaveBeenCalledWith("google-oauth-token");
      expect(userService.create).toHaveBeenCalledWith({
        email: googleUser.email,
        username: "Google_User",
        password: "",
        roles: []
      });
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

      const existingUser = {
        id: 6,
        email: googleUser.email,
        username: "existing_user",
        nickname: null,
        password: "somepass",
        createdAt: new Date()
      };

      const googleAuthService = {
        verifyGoogleToken: jest.fn().mockResolvedValue(googleUser)
      };

      userService.findByEmail.mockResolvedValue(existingUser);
      jwtService.sign.mockReturnValue("existing-token-xyz");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: UserService, useValue: userService },
          { provide: JwtService, useValue: jwtService },
          { provide: GoogleAuthService, useValue: googleAuthService },
          { provide: PrismaService, useValue: prismaService },
          { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
            if (key === "JWT_EXPIRES_IN") return "1h";
            if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
            return undefined;
          }) } }
        ]
      }).compile();

      const testAuthService = module.get<AuthService>(AuthService);

      const result = await testAuthService.loginWithGoogle("google-oauth-token");

      expect(googleAuthService.verifyGoogleToken).toHaveBeenCalledWith("google-oauth-token");
      expect(userService.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        access_token: "existing-token-xyz",
        refresh_token: "existing-token-xyz"
      });
    });
  });

  describe("refreshToken", () => {
    it("should throw UnauthorizedException if refresh token not found", async () => {
      const mockPrisma = {
        ...prismaService,
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          deleteMany: jest.fn(),
          delete: jest.fn()
        }
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: UserService, useValue: userService },
          { provide: JwtService, useValue: jwtService },
          { provide: GoogleAuthService, useValue: {} },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
            if (key === "JWT_EXPIRES_IN") return "1h";
            if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
            return undefined;
          }) } }
        ]
      }).compile();

      const testAuthService = module.get<AuthService>(AuthService);

      await expect(
        testAuthService.refreshToken("invalid-token")
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException if refresh token expired", async () => {
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const mockPrisma = {
        ...prismaService,
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            token: "expired-token",
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
          }),
          delete: jest.fn(),
          create: jest.fn(),
          deleteMany: jest.fn()
        }
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: UserService, useValue: userService },
          { provide: JwtService, useValue: jwtService },
          { provide: GoogleAuthService, useValue: {} },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
            if (key === "JWT_EXPIRES_IN") return "1h";
            if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
            return undefined;
          }) } }
        ]
      }).compile();

      const testAuthService = module.get<AuthService>(AuthService);

      await expect(
        testAuthService.refreshToken("expired-token")
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: 1 }
      });
    });

    it("should return new tokens for valid refresh token", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days from now
      const mockPrisma = {
        $transaction: jest.fn((callback: any) => {
          const txClient = {
            refreshToken: {
              delete: jest.fn().mockResolvedValue({ id: 1 }),
              create: jest.fn().mockResolvedValue({ id: 2, token: "new-refresh", userId: 1, expiresAt: futureDate })
            }
          };
          return callback(txClient);
        }),
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            token: "valid-token",
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
          }),
          create: jest.fn(),
          deleteMany: jest.fn()
        }
      };

      jwtService.sign.mockReturnValue("new-access-token");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: UserService, useValue: userService },
          { provide: JwtService, useValue: jwtService },
          { provide: GoogleAuthService, useValue: {} },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
            if (key === "JWT_EXPIRES_IN") return "1h";
            if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
            return undefined;
          }) } }
        ]
      }).compile();

      const testAuthService = module.get<AuthService>(AuthService);

      const result = await testAuthService.refreshToken("valid-token");

      expect(result).toEqual({
        access_token: "new-access-token",
        refresh_token: "new-access-token"
      });
    });
  });

  describe("revokeRefreshToken", () => {
    it("should delete refresh token", async () => {
      const mockPrisma = {
        ...prismaService,
        refreshToken: {
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn()
        }
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: UserService, useValue: userService },
          { provide: JwtService, useValue: jwtService },
          { provide: GoogleAuthService, useValue: {} },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: { get: jest.fn() } }
        ]
      }).compile();

      const testAuthService = module.get<AuthService>(AuthService);

      await testAuthService.revokeRefreshToken("token-to-revoke");

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: "token-to-revoke" }
      });
    });
  });

  describe("validateUser edge cases", () => {
    it("should throw UnauthorizedException if user has no password", async () => {
      const mockUser = {
        id: 1,
        email: "google@example.com",
        username: "googleuser",
        nickname: null,
        password: null,
        createdAt: new Date()
      };
      userService.findByEmail.mockResolvedValue(mockUser as any);

      await expect(
        authService.validateUser("google@example.com", "password")
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
