import { Test, TestingModule } from "@nestjs/testing";
import { RolesGuard } from "./roles.guard";
import { Reflector } from "@nestjs/core";
import { UserService } from "@user/user.service";
import { ExecutionContext } from "@nestjs/common";

jest.mock("@user/user.service");

describe("RolesGuard", () => {
  let guard: RolesGuard;
  let reflector: Reflector;
  let userService: jest.Mocked<UserService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            getUserRoles: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
    userService = module.get<UserService>(UserService) as any;
  });

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  describe("canActivate", () => {
    const createMockContext = (user: any): ExecutionContext => {
      return {
        switchToHttp: () => ({
          getRequest: () => ({
            user: user,
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as any;
    };

    it("should return true when no roles are required", async () => {
      reflector.getAllAndOverride = jest.fn().mockReturnValue(undefined);
      
      const context = createMockContext({ id: 1 });
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(userService.getUserRoles).not.toHaveBeenCalled();
    });

    it("should return false when user is not authenticated", async () => {
      reflector.getAllAndOverride = jest.fn().mockReturnValue(["admin"]);
      
      const context = createMockContext(null);
      const result = await guard.canActivate(context);

      expect(result).toBe(false);
      expect(userService.getUserRoles).not.toHaveBeenCalled();
    });

    it("should return false when user has no id", async () => {
      reflector.getAllAndOverride = jest.fn().mockReturnValue(["admin"]);
      
      const context = createMockContext({});
      const result = await guard.canActivate(context);

      expect(result).toBe(false);
      expect(userService.getUserRoles).not.toHaveBeenCalled();
    });

    it("should return true when user has required role", async () => {
      reflector.getAllAndOverride = jest.fn().mockReturnValue(["admin"]);
      userService.getUserRoles.mockResolvedValue(["user", "admin"]);
      
      const context = createMockContext({ id: 1 });
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(userService.getUserRoles).toHaveBeenCalledWith(1);
    });

    it("should return false when user does not have required role", async () => {
      reflector.getAllAndOverride = jest.fn().mockReturnValue(["admin"]);
      userService.getUserRoles.mockResolvedValue(["user"]);
      
      const context = createMockContext({ id: 1 });
      const result = await guard.canActivate(context);

      expect(result).toBe(false);
      expect(userService.getUserRoles).toHaveBeenCalledWith(1);
    });

    it("should return true when user has one of multiple required roles", async () => {
      reflector.getAllAndOverride = jest.fn().mockReturnValue(["admin", "moderator"]);
      userService.getUserRoles.mockResolvedValue(["user", "moderator"]);
      
      const context = createMockContext({ id: 1 });
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(userService.getUserRoles).toHaveBeenCalledWith(1);
    });
  });
});