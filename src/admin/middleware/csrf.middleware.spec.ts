import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NextFunction, Request, Response } from "express";
import { AdminCsrfMiddleware } from "./csrf.middleware";

const ADMIN_URL = "https://admin.naucto.com";

function makeMiddleware(): AdminCsrfMiddleware {
  const config = {
    get: jest.fn().mockReturnValue(ADMIN_URL)
  } as unknown as ConfigService;

  return new AdminCsrfMiddleware(config);
}

function makeRequest(overrides: {
  method?: string;
  path?: string;
  origin?: string;
  cookieToken?: string;
  headerToken?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (overrides.origin) headers["origin"] = overrides.origin;
  if (overrides.headerToken) headers["x-csrf-token"] = overrides.headerToken;

  return {
    method: overrides.method ?? "POST",
    path: overrides.path ?? "/admin/users/1/ban",
    headers,
    cookies: overrides.cookieToken
      ? { naucto_admin_csrf: overrides.cookieToken }
      : {}
  } as unknown as Request;
}

describe("AdminCsrfMiddleware", () => {
  let middleware: AdminCsrfMiddleware;
  let next: NextFunction;
  const res = {} as Response;

  beforeEach(() => {
    middleware = makeMiddleware();
    next = jest.fn();
  });

  it("lets safe methods through without a token", () => {
    middleware.use(makeRequest({ method: "GET" }), res, next);

    expect(next).toHaveBeenCalled();
  });

  it("accepts a write whose header echoes the cookie", () => {
    middleware.use(
      makeRequest({ cookieToken: "abc", headerToken: "abc" }),
      res,
      next
    );

    expect(next).toHaveBeenCalled();
  });

  it("rejects a write with no CSRF header", () => {
    expect(() =>
      middleware.use(makeRequest({ cookieToken: "abc" }), res, next)
    ).toThrow(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a write whose header does not match the cookie", () => {
    expect(() =>
      middleware.use(
        makeRequest({ cookieToken: "abc", headerToken: "def" }),
        res,
        next
      )
    ).toThrow(ForbiddenException);
  });

  it("rejects a write from an unknown origin", () => {
    expect(() =>
      middleware.use(
        makeRequest({
          origin: "https://evil.example",
          cookieToken: "abc",
          headerToken: "abc"
        }),
        res,
        next
      )
    ).toThrow(ForbiddenException);
  });

  it("accepts a write from the admin panel's own origin", () => {
    middleware.use(
      makeRequest({ origin: ADMIN_URL, cookieToken: "abc", headerToken: "abc" }),
      res,
      next
    );

    expect(next).toHaveBeenCalled();
  });

  describe("login and refresh", () => {
    // Both run before the panel holds a CSRF cookie, so they are exempt from the
    // double-submit check -- but not from the origin check.

    it.each(["/admin/auth/login", "/admin/auth/refresh"])(
      "%s is exempt from the double-submit check",
      (path) => {
        middleware.use(makeRequest({ path }), res, next);

        expect(next).toHaveBeenCalled();
      }
    );

    it.each(["/admin/auth/login", "/admin/auth/refresh"])(
      "%s is still rejected from a foreign origin",
      (path) => {
        expect(() =>
          middleware.use(
            makeRequest({ path, origin: "https://evil.example" }),
            res,
            next
          )
        ).toThrow(ForbiddenException);
      }
    );
  });
});
