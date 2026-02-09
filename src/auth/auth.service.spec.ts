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

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: GoogleAuthService, useValue: {} },
        { provide: PrismaService, useValue: { $transaction: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } }
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
      expect(result).toEqual({ access_token: "token123" });
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email
      });
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
      expect(result).toEqual({ access_token: "token123" });
    });
  });
});
