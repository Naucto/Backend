import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_ROLE } from "@auth/decorators/admin-only.decorator";
import { Roles } from "@auth/decorators/roles.decorator";
import { UserService } from "@user/user.service";
import { RolesGuard } from "./roles.guard";

class Routes {
  open(): void {}

  @Roles(ADMIN_ROLE)
  adminOnly(): void {}
}

const contextFor = (handler: () => void, userId?: number): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({
      getRequest: () => ({ user: userId === undefined ? undefined : { id: userId } })
    })
  }) as unknown as ExecutionContext;

describe("RolesGuard", () => {
  const userService = { getUserRoles: jest.fn() };
  const guard = new RolesGuard(new Reflector(), userService as unknown as UserService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lets anyone through a route that asks for no role", async () => {
    await expect(guard.canActivate(contextFor(Routes.prototype.open))).resolves.toBe(true);
    expect(userService.getUserRoles).not.toHaveBeenCalled();
  });

  it("lets a holder of the role through", async () => {
    userService.getUserRoles.mockResolvedValue([ "Member", ADMIN_ROLE ]);

    await expect(guard.canActivate(contextFor(Routes.prototype.adminOnly, 7))).resolves.toBe(true);
    expect(userService.getUserRoles).toHaveBeenCalledWith(7);
  });

  it("refuses a user who holds other roles only", async () => {
    userService.getUserRoles.mockResolvedValue([ "Member" ]);

    await expect(guard.canActivate(contextFor(Routes.prototype.adminOnly, 7))).resolves.toBe(false);
  });

  it("refuses a user who holds no role", async () => {
    userService.getUserRoles.mockResolvedValue([]);

    await expect(guard.canActivate(contextFor(Routes.prototype.adminOnly, 7))).resolves.toBe(false);
  });

  it("refuses a request nobody is signed in on, without looking any role up", async () => {
    await expect(guard.canActivate(contextFor(Routes.prototype.adminOnly))).resolves.toBe(false);
    expect(userService.getUserRoles).not.toHaveBeenCalled();
  });
});
