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
  accountStatus: AccountStatus.ACTIVE,
  password: "$2b$10$averyrealbcrypthash",
  roles: [{ id: 2, name: "Moderator" }]
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

      await expect(strategy.validate(payload("user"))).resolves.toMatchObject({
        id: ACTIVE_USER.id,
        email: ACTIVE_USER.email
      });
    });

    it("accepts a token minted before the scope claim existed", async () => {
      const { config, userService } = makeDeps();
      const strategy = new JwtStrategy(config, userService);

      await expect(strategy.validate(payload())).resolves.toMatchObject({
        id: ACTIVE_USER.id
      });
    });

    it("rejects an admin cookie token used as a bearer token", async () => {
      const { config, userService } = makeDeps();
      const strategy = new JwtStrategy(config, userService);

      await expect(strategy.validate(payload("admin"))).rejects.toThrow(
        UnauthorizedException
      );
      expect(userService.findOne).not.toHaveBeenCalled();
    });

    it("never puts the password hash on the request", async () => {
      const { config, userService } = makeDeps();
      const strategy = new JwtStrategy(config, userService);

      const user = await strategy.validate(payload("user"));

      // `req.user` is handed to every guarded handler; GET /users/profile used
      // to echo it straight back, hash included.
      expect(user?.password).toBeNull();
    });

    it("loads roles so handlers and staff UI can read them", async () => {
      const { config, userService } = makeDeps();
      const strategy = new JwtStrategy(config, userService);

      const user = await strategy.validate(payload("user"));

      expect(user?.roles).toEqual([{ id: 2, name: "Moderator" }]);
      expect(userService.findOne).toHaveBeenCalledWith(1, { roles: true });
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

      await expect(strategy.validate(payload("admin"))).resolves.toMatchObject({
        id: ACTIVE_USER.id,
        email: ACTIVE_USER.email
      });
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

    it("never puts the password hash on the request", async () => {
      const { config, userService } = makeDeps();
      const strategy = new AdminJwtStrategy(config, userService);

      const user = await strategy.validate(payload("admin"));

      expect(user.password).toBeNull();
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
