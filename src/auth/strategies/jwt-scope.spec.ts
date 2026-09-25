import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountStatus } from "@prisma/client";
import { UserService } from "@user/user.service";
import { AuthenticatedRequest, JwtPayload } from "@auth/auth.types";
import { JwtStrategy } from "./jwt.strategy";

describe("JWT authentication", () => {
  const user = { id: 1, email: "staff@example.com", password: "hash", accountStatus: AccountStatus.ACTIVE,
    roles: [{ id: 2, name: "Reviewer", permissions: ["MODERATE_CONTENT"] }] };
  const findOne = jest.fn();
  const strategy = new JwtStrategy(
    { getOrThrow: (): string => "test-secret" } as unknown as ConfigService,
    { findOne } as unknown as UserService
  );
  const request = (bearer = true): AuthenticatedRequest => ({
    headers: bearer ? { authorization: "Bearer access" } : {},
    cookies: bearer ? {} : { naucto_admin_access: "access" }
  }) as AuthenticatedRequest;
  const payload = (scope?: "user" | "admin"): JwtPayload => ({
    sub: 1, email: user.email, ...(scope ? { scope } : {})
  });

  beforeEach(() => { findOne.mockReset().mockResolvedValue(user); });

  it.each(["user", "admin", undefined] as const)("validates %s bearer scope with one strategy", async (scope) => {
    const req = request();
    const result = await strategy.validate(req, payload(scope));
    expect(req.tokenScope).toBe(scope ?? "user");
    expect(result).toMatchObject({ id: 1, password: null, roles: user.roles });
  });

  it("validates an admin cookie and loads current permissions", async () => {
    const req = request(false);
    await expect(strategy.validate(req, payload("admin"))).resolves.toMatchObject({ roles: user.roles });
    expect(req.tokenScope).toBe("admin");
    expect(findOne).toHaveBeenCalledWith(1, { roles: true });
  });

  it.each(["user", undefined] as const)("rejects %s tokens in the staff cookie", async (scope) => {
    await expect(strategy.validate(request(false), payload(scope))).rejects.toThrow(UnauthorizedException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it("rejects refresh tokens at access-token endpoints", async () => {
    await expect(strategy.validate(request(), { ...payload("admin"), tokenUse: "refresh" }))
      .rejects.toThrow(UnauthorizedException);
  });

  it("rejects banned users", async () => {
    findOne.mockResolvedValue({ ...user, accountStatus: AccountStatus.BANNED });
    await expect(strategy.validate(request(), payload("user"))).rejects.toThrow(UnauthorizedException);
  });
});
