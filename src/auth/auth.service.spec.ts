import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { UserService } from "@user/user.service";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { Prisma, User } from "@prisma/client";
import { GoogleAuthService } from "./providers/google-auth.service";
import { GithubAuthService } from "./providers/github-auth.service";
import { MicrosoftAuthService } from "./providers/microsoft-auth.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";

jest.mock("bcryptjs", () => ({
  compare: jest.fn()
}));

const configServiceValue = {
  get: jest.fn((key: string) => {
    if (key === "JWT_EXPIRES_IN") return "1h";
    if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
    return undefined;
  })
};

const HANDLE_RULE = /^[a-zA-Z0-9._-]{3,24}$/;

const userRow = (overrides: Partial<User> = {}): User => ({
  id: 1,
  email: "test@example.com",
  username: "testuser",
  nickname: null,
  description: null,
  password: "hashedPass",
  createdAt: new Date(),
  friendCode: null,
  colour: null,
  sessionJoinPolicy: "ANYONE",
  deletedAt: null,
  ...overrides
});

type RefreshTokenMock = Record<"create" | "deleteMany" | "findUnique" | "delete", jest.Mock>;

interface PrismaMock {
  /** The client a `$transaction` callback receives, kept apart so a test can tell the two. */
  tx: { refreshToken: RefreshTokenMock };
  $transaction: jest.Mock;
  refreshToken: RefreshTokenMock;
  user: { findUnique: jest.Mock };
}

function makeRefreshTokenMock(overrides: Partial<RefreshTokenMock> = {}): RefreshTokenMock {
  return {
    create: jest.fn().mockResolvedValue({
      id: 1,
      token: "stored",
      userId: 1,
      expiresAt: new Date()
    }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue({ id: 1 }),
    ...overrides
  };
}

function makePrisma(refreshTokenOverrides: Partial<RefreshTokenMock> = {}): PrismaMock {
  const tx = { refreshToken: makeRefreshTokenMock() };

  return {
    tx,
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    refreshToken: makeRefreshTokenMock(refreshTokenOverrides),
    user: { findUnique: jest.fn() }
  };
}

describe("AuthService", () => {
  let authService: AuthService;

  const userService: jest.Mocked<
    Pick<UserService, "findByEmail" | "findAll" | "create" | "createOAuthUser" | "updatePassword">
  > = {
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    createOAuthUser: jest.fn(),
    updatePassword: jest.fn()
  };

  const jwtService: jest.Mocked<Pick<JwtService, "sign" | "verify">> = {
    sign: jest.fn().mockReturnValue("token123"),
    verify: jest.fn().mockReturnValue({ sub: 1, email: "test@test.com" })
  };

  const prismaService = makePrisma();

  async function buildModule(
    prisma = prismaService,
    providers: { google?: object; github?: object; microsoft?: object } = {}
  ): Promise<AuthService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: GoogleAuthService, useValue: providers.google ?? {} },
        { provide: GithubAuthService, useValue: providers.github ?? {} },
        { provide: MicrosoftAuthService, useValue: providers.microsoft ?? {} },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configServiceValue }
      ]
    }).compile();
    return module.get<AuthService>(AuthService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    (jwtService.sign as jest.Mock).mockReturnValue("token123");
    (jwtService.verify as jest.Mock).mockReturnValue({
      sub: 1,
      email: "test@test.com"
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

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
      userService.findByEmail.mockResolvedValue(userRow());
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      await expect(
        authService.validateUser("test@example.com", "wrongpass")
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should return user if email and password are valid", async () => {
      const mockUser = userRow();
      userService.findByEmail.mockResolvedValue(mockUser);
      const result = await authService.validateUser(
        "test@example.com",
        "password"
      );
      expect(result).toEqual(mockUser);
    });

    it("should throw UnauthorizedException if user has no password", async () => {
      userService.findByEmail.mockResolvedValue(
        userRow({ email: "google@example.com", username: "googleuser", password: null })
      );

      await expect(
        authService.validateUser("google@example.com", "password")
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("login", () => {
    it("should return access token if credentials are valid", async () => {
      const mockUser = userRow();
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

    it("should replace the user's sessions with the new one inside a single transaction", async () => {
      const mockUser = userRow({ id: 3 });
      jest.spyOn(authService, "validateUser").mockResolvedValue(mockUser);

      await authService.login("test@example.com", "password");

      const { deleteMany, create } = prismaService.tx.refreshToken;
      expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 3 } });
      expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 3 }) });
      expect(deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        create.mock.invocationCallOrder[0] ?? 0
      );
      expect(prismaService.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe("register", () => {
    /** The body a client actually receives, which is where the field and the code live. */
    const conflictBodyOf = async (email: string, username: string): Promise<unknown> => {
      try {
        await authService.register({ email, username, password: "pass", roles: [] });
      } catch (err) {
        return (err as ConflictException).getResponse();
      }

      throw new Error("expected a conflict");
    };

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
            return [ userRow({ email: emailFilter, username: "user" }) ];
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

      await expect(conflictBodyOf("exists@example.com", "user")).resolves.toEqual(
        expect.objectContaining({
          statusCode: 409,
          violations: [ { field: "email", code: "EMAIL_TAKEN" } ]
        })
      );
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
            return [ userRow({ id: 2, email: "user@example.com", username: usernameFilter }) ];
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

      await expect(conflictBodyOf("free@example.com", "existsUser")).resolves.toEqual(
        expect.objectContaining({
          statusCode: 409,
          violations: [ { field: "username", code: "USERNAME_TAKEN" } ]
        })
      );
    });

    it("should create user and return access token", async () => {
      userService.findAll.mockResolvedValue([]);
      userService.create.mockResolvedValue(
        userRow({ email: "new@example.com", username: "newUser" })
      );

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

  describe("sign-in through a provider", () => {
    const signInWithGoogle = async (email: string, name: string): Promise<unknown> => {
      const service = await buildModule(prismaService, {
        google: { getUserFromCode: jest.fn().mockResolvedValue({ email, name }) }
      });

      return service.loginWithGoogleCode("code", "verifier");
    };

    const mintedUsername = (): string | undefined => userService.createOAuthUser.mock.calls[0]?.[1];

    it("should sign an account that already holds the address in, and create nothing", async () => {
      userService.findByEmail.mockResolvedValue(userRow({ id: 4, email: "ada@example.com" }));

      await expect(signInWithGoogle("ada@example.com", "Ada Lovelace")).resolves.toEqual({
        access_token: "token123",
        refresh_token: "token123"
      });

      expect(userService.createOAuthUser).not.toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 4, email: "ada@example.com" },
        expect.any(Object)
      );
    });

    it("should create the account under the provider's name when that handle is free", async () => {
      userService.findByEmail.mockResolvedValue(undefined);
      userService.findAll.mockResolvedValue([]);
      userService.createOAuthUser.mockResolvedValue(userRow({ id: 5, email: "ada@example.com" }));

      await signInWithGoogle("ada@example.com", "Ada Lovelace");

      expect(userService.createOAuthUser).toHaveBeenCalledWith("ada@example.com", "Ada_Lovelace");
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 5, email: "ada@example.com" },
        expect.any(Object)
      );
    });

    it("should tell the new account apart with a suffix when the handle is taken", async () => {
      userService.findByEmail.mockResolvedValue(undefined);
      userService.findAll.mockResolvedValue([ userRow({ username: "Ada_Lovelace" }) ]);
      userService.createOAuthUser.mockResolvedValue(userRow({ id: 5 }));

      await signInWithGoogle("ada@example.com", "Ada Lovelace");

      expect(mintedUsername()).toMatch(/^Ada_Lovelace_[0-9a-f]{5}$/);
    });

    it.each([
      [ "José García", "Jose_Garcia" ],
      [ "山田太郎", "user" ],
      [ "AC/DC Fan", "AC_DC_Fan" ],
      [ "Li", "user" ],
      [ "A display name of thirty chars", "A_display_name_of_" ]
    ])("should mint a handle the profile rule accepts from %s", async (name, expected) => {
      userService.findByEmail.mockResolvedValue(undefined);
      userService.createOAuthUser.mockResolvedValue(userRow({ id: 5 }));

      userService.findAll.mockResolvedValue([]);
      await signInWithGoogle("someone@example.com", name);
      expect(mintedUsername()).toBe(expected);

      userService.createOAuthUser.mockClear();
      userService.findAll.mockResolvedValue([ userRow() ]);
      await signInWithGoogle("someone@example.com", name);
      expect(mintedUsername()).toMatch(HANDLE_RULE);
    });

    it("should sign in whoever GitHub vouches for", async () => {
      userService.findByEmail.mockResolvedValue(userRow({ id: 6, email: "grace@example.com" }));
      const getUserFromCode = jest.fn().mockResolvedValue({ email: "grace@example.com", name: "Grace" });
      const service = await buildModule(prismaService, { github: { getUserFromCode } });

      await service.loginWithGithub("code");

      expect(getUserFromCode).toHaveBeenCalledWith("code");
      expect(userService.findByEmail).toHaveBeenCalledWith("grace@example.com");
    });

    it("should sign in whoever Microsoft vouches for", async () => {
      userService.findByEmail.mockResolvedValue(userRow({ id: 6, email: "grace@example.com" }));
      const verifyToken = jest.fn().mockResolvedValue({ email: "grace@example.com", name: "Grace" });
      const service = await buildModule(prismaService, { microsoft: { verifyToken } });

      await service.loginWithMicrosoft("id-token");

      expect(verifyToken).toHaveBeenCalledWith("id-token");
      expect(userService.findByEmail).toHaveBeenCalledWith("grace@example.com");
    });
  });

  describe("refreshToken", () => {
    const storedToken = (expiresAt: Date): object => ({
      id: 1,
      expiresAt,
      user: { id: 1, email: "user@example.com" }
    });

    it("should throw UnauthorizedException if the token fails verification", async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error("jwt expired");
      });

      await expect(authService.refreshToken("stale-token")).rejects.toThrow(
        UnauthorizedException
      );
      expect(prismaService.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException if refresh token not found", async () => {
      const prisma = makePrisma({ findUnique: jest.fn().mockResolvedValue(null) });
      const svc = await buildModule(prisma);

      await expect(svc.refreshToken("invalid-token")).rejects.toThrow(
        UnauthorizedException
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException if refresh token expired", async () => {
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60);
      const deleteOne = jest.fn().mockResolvedValue({ id: 1 });
      const prisma = makePrisma({
        findUnique: jest.fn().mockResolvedValue(storedToken(expiredDate)),
        delete: deleteOne
      });
      const svc = await buildModule(prisma);

      await expect(svc.refreshToken("expired-token")).rejects.toThrow(
        UnauthorizedException
      );
      expect(deleteOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
    });

    it("should consume the presented token and issue its replacement inside one transaction", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      (jwtService.sign as jest.Mock).mockReturnValue("new-token");

      const prisma = makePrisma({
        findUnique: jest.fn().mockResolvedValue(storedToken(futureDate))
      });
      const svc = await buildModule(prisma);

      const result = await svc.refreshToken("valid-token");

      expect(result).toEqual({
        access_token: "new-token",
        refresh_token: "new-token"
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 1, email: "user@example.com" },
        expect.any(Object)
      );
      expect(prisma.tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(prisma.tx.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 1 })
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("should issue nothing when the presented token was consumed in the meantime", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const prisma = makePrisma({
        findUnique: jest.fn().mockResolvedValue(storedToken(futureDate))
      });
      prisma.tx.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      const svc = await buildModule(prisma);

      await expect(svc.refreshToken("valid-token")).rejects.toThrow(UnauthorizedException);
      expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe("revokeAllRefreshTokens", () => {
    it("should delete every refresh token of the user, and of nobody else", async () => {
      await authService.revokeAllRefreshTokens(7);

      expect(prismaService.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    });
  });

  describe("changePassword", () => {
    it("should refuse when the account is gone", async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(authService.changePassword(1, "new-password-1")).rejects.toThrow(
        UnauthorizedException
      );
      expect(userService.updatePassword).not.toHaveBeenCalled();
    });

    it("should require the current password of an account that has one", async () => {
      prismaService.user.findUnique.mockResolvedValue(userRow());

      await expect(authService.changePassword(1, "new-password-1")).rejects.toThrow(
        BadRequestException
      );
      expect(userService.updatePassword).not.toHaveBeenCalled();
    });

    it("should refuse a current password that is wrong", async () => {
      prismaService.user.findUnique.mockResolvedValue(userRow());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.changePassword(1, "new-password-1", "not-the-password")
      ).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).toHaveBeenCalledWith("not-the-password", "hashedPass");
      expect(userService.updatePassword).not.toHaveBeenCalled();
    });

    it("should let an account without a password set one, asking for no current password", async () => {
      prismaService.user.findUnique.mockResolvedValue(userRow({ password: null }));

      await authService.changePassword(1, "new-password-1");

      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(userService.updatePassword).toHaveBeenCalledWith(1, "new-password-1", prismaService.tx);
    });

    it("should end every session opened under the old password and hand the caller a new one", async () => {
      prismaService.user.findUnique.mockResolvedValue(userRow());

      await expect(
        authService.changePassword(1, "new-password-1", "the-password")
      ).resolves.toEqual({ access_token: "token123", refresh_token: "token123" });

      const { deleteMany, create } = prismaService.tx.refreshToken;
      expect(userService.updatePassword).toHaveBeenCalledWith(1, "new-password-1", prismaService.tx);
      expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 1 }) });
      expect(prismaService.refreshToken.deleteMany).not.toHaveBeenCalled();
    });
  });
});
