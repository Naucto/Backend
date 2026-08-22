import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountStatus, User } from "@prisma/client";
import { UserService } from "@user/user.service";
import { JwtPayload } from "@auth/auth.types";
import { JwtStrategy } from "./jwt.strategy";
import { AdminJwtStrategy } from "./admin-jwt.strategy";

const ACTIVE_USER = {
  id: 1,
  email: "user@naucto.com",
  accountStatus: AccountStatus.ACTIVE
} as unknown as User;

function makeDeps(user: User = ACTIVE_USER): {
  config: ConfigService;
  userService: UserService;
} {
  return {
    config: {
      getOrThrow: jest.fn().mockReturnValue("test-secret")
    } as unknown as ConfigService,
    userService: {
      findOne: jest.fn().mockResolvedValue(user)
    } as unknown as UserService
  };
}

const payload = (scope?: "user" | "admin"): JwtPayload => ({
  sub: 1,
  email: ACTIVE_USER.email,
  ...(scope ? { scope } : {})
});

// Admin cookies and API bearer tokens are signed with the same secret, so
// without the scope claim either one would satisfy either strategy.
describe("JWT scope separation", () => {
  describe("JwtStrategy (API bearer tokens)", () => {
    it("accepts a user-scoped token", async () => {
      const { config, userService } = makeDeps();
      const strategy = new JwtStrategy(config, userService);

      await expect(strategy.validate(payload("user"))).resolves.toBe(
        ACTIVE_USER
      );
    });

    it("accepts a token minted before the scope claim existed", async () => {
      const { config, userService } = makeDeps();
      const strategy = new JwtStrategy(config, userService);

      await expect(strategy.validate(payload())).resolves.toBe(ACTIVE_USER);
    });

    it("rejects an admin cookie token used as a bearer token", async () => {
      const { config, userService } = makeDeps();
      const strategy = new JwtStrategy(config, userService);

      await expect(strategy.validate(payload("admin"))).rejects.toThrow(
        UnauthorizedException
      );
      expect(userService.findOne).not.toHaveBeenCalled();
    });

    it("rejects a banned user", async () => {
      const banned = {
        ...ACTIVE_USER,
        accountStatus: AccountStatus.BANNED
      } as User;
      const { config, userService } = makeDeps(banned);
      const strategy = new JwtStrategy(config, userService);

      await expect(strategy.validate(payload("user"))).rejects.toThrow(
        UnauthorizedException
      );
    });
  });

  describe("AdminJwtStrategy (admin cookies)", () => {
    it("accepts an admin-scoped token", async () => {
      const { config, userService } = makeDeps();
      const strategy = new AdminJwtStrategy(config, userService);

      await expect(strategy.validate(payload("admin"))).resolves.toBe(
        ACTIVE_USER
      );
    });

    it("rejects an API token pasted into the admin cookie", async () => {
      const { config, userService } = makeDeps();
      const strategy = new AdminJwtStrategy(config, userService);

      await expect(strategy.validate(payload("user"))).rejects.toThrow(
        UnauthorizedException
      );
      expect(userService.findOne).not.toHaveBeenCalled();
    });

    it("rejects an unscoped legacy token", async () => {
      const { config, userService } = makeDeps();
      const strategy = new AdminJwtStrategy(config, userService);

      await expect(strategy.validate(payload())).rejects.toThrow(
        UnauthorizedException
      );
    });

    it("rejects a banned staff account", async () => {
      const banned = {
        ...ACTIVE_USER,
        accountStatus: AccountStatus.BANNED
      } as User;
      const { config, userService } = makeDeps(banned);
      const strategy = new AdminJwtStrategy(config, userService);

      await expect(strategy.validate(payload("admin"))).rejects.toThrow(
        UnauthorizedException
      );
    });
  });
});
