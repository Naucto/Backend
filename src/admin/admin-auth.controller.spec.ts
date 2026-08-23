import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { Request, Response } from "express";
import { AccountStatus } from "@prisma/client";
import { AuthService } from "@auth/auth.service";
import { RequestWithUser } from "@auth/auth.types";
import { UserService } from "@user/user.service";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminLoginDto } from "./dto/admin-login.dto";

const ACCESS_COOKIE = "naucto_admin_access";
const REFRESH_COOKIE = "naucto_admin_refresh";
const CSRF_COOKIE = "naucto_admin_csrf";

const STAFF = {
  id: 3,
  email: "mod@naucto.com",
  username: "mod",
  nickname: null,
  accountStatus: AccountStatus.ACTIVE
};

const ADMIN_TOKENS = {
  access_token: "access",
  refresh_token: "refresh",
  access_token_max_age_ms: 30 * 60 * 1000,
  refresh_token_max_age_ms: 8 * 60 * 60 * 1000,
  userId: STAFF.id
};

type AuthServiceMock = {
  validateUser: jest.Mock;
  generateAdminTokens: jest.Mock;
  refreshAdminTokens: jest.Mock;
  revokeRefreshToken: jest.Mock;
};

type UserServiceMock = {
  getUserRoles: jest.Mock;
  findOne: jest.Mock;
};

type ResponseMock = Response & {
  cookie: jest.Mock;
  clearCookie: jest.Mock;
};

function makeResponse(): ResponseMock {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn()
  } as unknown as ResponseMock;
}

function makeRequest(cookies: Record<string, string> = {}): Request {
  return { cookies } as unknown as Request;
}

/** The cookie options a given `res.cookie(name, ...)` call was made with. */
function cookieCall(
  res: ResponseMock,
  name: string
): { value: string; options: Record<string, unknown> } | undefined {
  const call = res.cookie.mock.calls.find(([cookieName]) => cookieName === name);
  return call ? { value: call[1], options: call[2] } : undefined;
}

describe("AdminAuthController", () => {
  let controller: AdminAuthController;
  let authService: AuthServiceMock;
  let userService: UserServiceMock;

  beforeEach(async () => {
    authService = {
      validateUser: jest.fn().mockResolvedValue(STAFF),
      generateAdminTokens: jest.fn().mockResolvedValue(ADMIN_TOKENS),
      refreshAdminTokens: jest.fn().mockResolvedValue(ADMIN_TOKENS),
      revokeRefreshToken: jest.fn().mockResolvedValue(undefined)
    };
    userService = {
      getUserRoles: jest.fn().mockResolvedValue(["Moderator"]),
      findOne: jest.fn().mockResolvedValue(STAFF)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UserService, useValue: userService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) }
        },
        Reflector,
        AdminCookieJwtGuard
      ]
    })
      .overrideGuard(AdminCookieJwtGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();

    controller = module.get<AdminAuthController>(AdminAuthController);
  });

  const credentials = (): AdminLoginDto =>
    ({ email: STAFF.email, password: "pw" }) as AdminLoginDto;

  describe("login", () => {
    it("returns the staff identity for a moderator", async () => {
      const res = makeResponse();

      await expect(controller.login(credentials(), res)).resolves.toEqual({
        id: STAFF.id,
        email: STAFF.email,
        username: STAFF.username,
        nickname: null,
        accountStatus: AccountStatus.ACTIVE,
        roles: ["Moderator"]
      });
    });

    it("rejects a user with no staff role", async () => {
      userService.getUserRoles.mockResolvedValue(["User"]);
      const res = makeResponse();

      await expect(controller.login(credentials(), res)).rejects.toThrow(
        ForbiddenException
      );
      expect(authService.generateAdminTokens).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it("sets the access and refresh cookies httpOnly", async () => {
      const res = makeResponse();

      await controller.login(credentials(), res);

      expect(cookieCall(res, ACCESS_COOKIE)?.options).toMatchObject({
        httpOnly: true,
        sameSite: "strict",
        maxAge: ADMIN_TOKENS.access_token_max_age_ms
      });
      // Scoped to the refresh endpoint so it is not sent on every admin request.
      expect(cookieCall(res, REFRESH_COOKIE)?.options).toMatchObject({
        httpOnly: true,
        path: "/admin/auth",
        maxAge: ADMIN_TOKENS.refresh_token_max_age_ms
      });
    });

    it("sets a readable CSRF cookie for the double-submit check", async () => {
      const res = makeResponse();

      await controller.login(credentials(), res);

      const csrf = cookieCall(res, CSRF_COOKIE);
      expect(csrf?.options).toMatchObject({ httpOnly: false });
      expect(csrf?.value).toMatch(/^[0-9a-f]{64}$/);
    });

    it("derives the cookie max-ages from the issued tokens", async () => {
      authService.generateAdminTokens.mockResolvedValue({
        ...ADMIN_TOKENS,
        access_token_max_age_ms: 111,
        refresh_token_max_age_ms: 222
      });
      const res = makeResponse();

      await controller.login(credentials(), res);

      // Re-deriving them from env here is what let the cookie lifetime drift
      // away from the token lifetime.
      expect(cookieCall(res, ACCESS_COOKIE)?.options["maxAge"]).toBe(111);
      expect(cookieCall(res, REFRESH_COOKIE)?.options["maxAge"]).toBe(222);
    });
  });

  describe("refresh", () => {
    it("rotates the cookies through the admin-scoped flow", async () => {
      const res = makeResponse();

      await controller.refresh(makeRequest({ [REFRESH_COOKIE]: "old" }), res);

      expect(authService.refreshAdminTokens).toHaveBeenCalledWith("old");
      expect(cookieCall(res, ACCESS_COOKIE)?.value).toBe("access");
      expect(cookieCall(res, REFRESH_COOKIE)?.value).toBe("refresh");
    });

    it("resolves the user from the rotation result, not by decoding the JWT", async () => {
      const res = makeResponse();

      await controller.refresh(makeRequest({ [REFRESH_COOKIE]: "old" }), res);

      expect(userService.findOne).toHaveBeenCalledWith(STAFF.id);
    });

    it("rejects a request with no refresh cookie", async () => {
      await expect(
        controller.refresh(makeRequest(), makeResponse())
      ).rejects.toThrow(UnauthorizedException);
      expect(authService.refreshAdminTokens).not.toHaveBeenCalled();
    });

    it("clears the cookies when staff access was revoked mid-session", async () => {
      userService.getUserRoles.mockResolvedValue(["User"]);
      const res = makeResponse();

      await expect(
        controller.refresh(makeRequest({ [REFRESH_COOKIE]: "old" }), res)
      ).rejects.toThrow(ForbiddenException);
      expect(res.clearCookie).toHaveBeenCalledWith(
        ACCESS_COOKIE,
        expect.any(Object)
      );
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("revokes the stored refresh token and clears every cookie", async () => {
      const res = makeResponse();

      await expect(
        controller.logout(makeRequest({ [REFRESH_COOKIE]: "old" }), res)
      ).resolves.toEqual({ success: true });

      expect(authService.revokeRefreshToken).toHaveBeenCalledWith("old");
      const cleared = res.clearCookie.mock.calls.map(([name]) => name);
      expect(cleared).toEqual(
        expect.arrayContaining([ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE])
      );
    });

    it("still clears the cookies when no refresh cookie was sent", async () => {
      const res = makeResponse();

      await controller.logout(makeRequest(), res);

      expect(authService.revokeRefreshToken).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

  describe("me", () => {
    it("returns the identity of the authenticated staff user", async () => {
      const req = { user: STAFF } as unknown as RequestWithUser;

      await expect(controller.me(req)).resolves.toMatchObject({
        id: STAFF.id,
        roles: ["Moderator"]
      });
    });

    it("rejects a user whose staff role was revoked", async () => {
      userService.getUserRoles.mockResolvedValue([]);
      const req = { user: STAFF } as unknown as RequestWithUser;

      await expect(controller.me(req)).rejects.toThrow(ForbiddenException);
    });
  });
});
