import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AuthService } from "./auth.service";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";

import { Response, Request } from "express";

describe("AuthController", () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            register: jest.fn()
          }
        },
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        },
        ConfigService,
      ]
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should call authService.login and return access_token", async () => {
    const loginDto = { email: "test@example.com", password: "password" };
    const expectedResult = {
      access_token: "token123",
      refresh_token: "refresh123"
    };

    (authService.login as jest.Mock).mockResolvedValue(expectedResult);

    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await controller.login(loginDto, mockRes as Response);

    expect(authService.login).toHaveBeenCalledWith(
      loginDto.email,
      loginDto.password
    );
    expect(mockRes.cookie).toHaveBeenCalledWith(
      "refresh_token",
      "refresh123",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000
      })
    );
    expect(result).toEqual({ access_token: "token123" });
  });

  it("should call authService.register and return access_token", async () => {
    const createUserDto = {
      email: "newuser@example.com",
      username: "newuser",
      password: "password123"
    };
    const expectedResult = {
      access_token: "token456",
      refresh_token: "refresh456"
    };

    (authService.register as jest.Mock).mockResolvedValue(expectedResult);

    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await controller.register(createUserDto, mockRes as Response);

    expect(authService.register).toHaveBeenCalledWith(createUserDto);
    expect(mockRes.cookie).toHaveBeenCalledWith(
      "refresh_token",
      "refresh456",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax"
      })
    );
    expect(result).toEqual({ access_token: "token456" });
  });

  it("should call authService.loginWithGoogle and return access_token", async () => {
    const googleToken = "google-oauth-token";
    const expectedResult = {
      access_token: "google-token789",
      refresh_token: "refresh789"
    };

    const authServiceWithGoogle = {
      ...authService,
      loginWithGoogle: jest.fn().mockResolvedValue(expectedResult)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceWithGoogle
        },
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        },
        ConfigService
      ]
    }).compile();

    const testController = module.get<AuthController>(AuthController);
    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await testController.loginWithGoogle(googleToken, mockRes as Response);

    expect(authServiceWithGoogle.loginWithGoogle).toHaveBeenCalledWith(googleToken);
    expect(mockRes.cookie).toHaveBeenCalled();
    expect(result).toEqual({ access_token: "google-token789" });
  });

  it("should refresh access token using refresh_token cookie", async () => {
    const refreshToken = "valid-refresh-token";
    const expectedResult = {
      access_token: "new-access-token",
      refresh_token: "new-refresh-token"
    };

    const authServiceWithRefresh = {
      ...authService,
      refreshToken: jest.fn().mockResolvedValue(expectedResult)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceWithRefresh
        },
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        },
        ConfigService
      ]
    }).compile();

    const testController = module.get<AuthController>(AuthController);
    const mockReq = {
      cookies: { refresh_token: refreshToken }
    } as unknown as Request;
    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await testController.refresh(mockReq, mockRes as Response);

    expect(authServiceWithRefresh.refreshToken).toHaveBeenCalledWith(refreshToken);
    expect(mockRes.cookie).toHaveBeenCalledWith(
      "refresh_token",
      "new-refresh-token",
      expect.any(Object)
    );
    expect(result).toEqual({ access_token: "new-access-token" });
  });

  it("should throw UnauthorizedException when refresh_token is missing", async () => {
    const mockReq = {
      cookies: {}
    } as Request;
    const mockRes: Partial<Response> = { cookie: jest.fn() };

    await expect(
      controller.refresh(mockReq, mockRes as Response)
    ).rejects.toThrow(UnauthorizedException);
  });

  it("should logout and clear refresh_token cookie", async () => {
    const refreshToken = "token-to-revoke";
    const authServiceWithRevoke = {
      ...authService,
      revokeRefreshToken: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceWithRevoke
        },
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        },
        ConfigService
      ]
    }).compile();

    const testController = module.get<AuthController>(AuthController);
    const mockReq = {
      cookies: { refresh_token: refreshToken }
    } as unknown as Request;
    const mockRes: Partial<Response> = {
      clearCookie: jest.fn()
    };
    const result = await testController.logout(mockReq, mockRes as Response);

    expect(authServiceWithRevoke.revokeRefreshToken).toHaveBeenCalledWith(refreshToken);
    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      "refresh_token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax"
      })
    );
    expect(result).toEqual({ success: true });
  });

  it("should logout successfully even without refresh_token cookie", async () => {
    const mockReq = {
      cookies: {}
    } as unknown as Request;
    const mockRes: Partial<Response> = {
      clearCookie: jest.fn()
    };
    const result = await controller.logout(mockReq, mockRes as Response);

    expect(result).toEqual({ success: true });
    expect(mockRes.clearCookie).not.toHaveBeenCalled();
  });
});
