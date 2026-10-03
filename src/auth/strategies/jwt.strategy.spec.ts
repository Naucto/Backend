import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { UserService } from "@user/user.service";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  let strategy: JwtStrategy;
  const userService = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UserService, useValue: userService },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue("test-secret") }
        }
      ]
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it("returns the user for a live account", async () => {
    const user = { id: 1, deletedAt: null };
    userService.findOne.mockResolvedValue(user);

    await expect(
      strategy.validate({ sub: 1, email: "a@b.c" })
    ).resolves.toEqual(user);
  });

  it("keeps the password hash off the request", async () => {
    userService.findOne.mockResolvedValue({ id: 1, password: "bcrypt-hash", deletedAt: null });

    await expect(
      strategy.validate({ sub: 1, email: "a@b.c" })
    ).resolves.not.toHaveProperty("password");
  });

  it("answers 401, not 404, when the token outlives its account", async () => {
    userService.findOne.mockRejectedValue(new NotFoundException("User with ID 1 not found"));

    await expect(
      strategy.validate({ sub: 1, email: "a@b.c" })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a soft-deleted account", async () => {
    userService.findOne.mockResolvedValue({ id: 1, deletedAt: new Date() });

    await expect(
      strategy.validate({ sub: 1, email: "a@b.c" })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
