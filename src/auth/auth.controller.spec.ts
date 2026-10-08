import {
  ExecutionContext,
  HttpStatus,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import request from 'supertest';

import { withEnv } from '../../test/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RequestWithUser } from './auth.types';
import { decryptRefreshToken, encryptRefreshToken } from './refresh-cookie.crypto';

describe('AuthController', () => {
  let module: TestingModule;
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    withEnv({ REFRESH_TOKEN_ENCRYPTION_KEY: 'test-refresh-cookie-key' });

    module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            register: jest.fn(),
            refreshToken: jest.fn(),
            changePassword: jest.fn(),
            revokeAllRefreshTokens: jest.fn().mockResolvedValue(undefined),
            getRefreshTokenMaxAgeMs: jest.fn().mockReturnValue(7 * 24 * 60 * 60 * 1000),
          },
        },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (context: ExecutionContext): boolean => {
              context.switchToHttp().getRequest().user = { id: 7 };
              return true;
            },
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call authService.login and return access_token', async () => {
    const loginDto = { email: 'test@example.com', password: 'password' };
    const expectedResult = {
      access_token: 'token123',
      refresh_token: 'refresh123',
    };

    (authService.login as jest.Mock).mockResolvedValue(expectedResult);

    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await controller.login(loginDto, mockRes as Response);

    expect(authService.login).toHaveBeenCalledWith(loginDto.email, loginDto.password);
    const [cookieName, cookieValue, cookieOptions] = (mockRes.cookie as jest.Mock).mock.calls[0];
    expect(cookieName).toBe('refresh_token');
    expect(cookieValue).not.toBe('refresh123');
    expect(decryptRefreshToken(cookieValue)).toBe('refresh123');
    expect(cookieOptions).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }),
    );
    expect(result).toEqual({ access_token: 'token123' });
  });

  it('should call authService.register and return access_token', async () => {
    const createUserDto = {
      email: 'newuser@example.com',
      username: 'newuser',
      password: 'password123',
    };
    const expectedResult = {
      access_token: 'token456',
      refresh_token: 'refresh456',
    };

    (authService.register as jest.Mock).mockResolvedValue(expectedResult);

    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await controller.register(createUserDto, mockRes as Response);

    expect(authService.register).toHaveBeenCalledWith(createUserDto);
    const [cookieName, cookieValue, cookieOptions] = (mockRes.cookie as jest.Mock).mock.calls[0];
    expect(cookieName).toBe('refresh_token');
    expect(cookieValue).not.toBe('refresh456');
    expect(decryptRefreshToken(cookieValue)).toBe('refresh456');
    expect(cookieOptions).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    expect(result).toEqual({ access_token: 'token456' });
  });

  it('should refresh access token using refresh_token cookie', async () => {
    const refreshToken = 'valid-refresh-token';
    (authService.refreshToken as jest.Mock).mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    });

    const mockReq = {
      cookies: { refresh_token: encryptRefreshToken(refreshToken) },
    } as unknown as Request;
    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await controller.refresh(mockReq, mockRes as Response);

    expect(authService.refreshToken).toHaveBeenCalledWith(refreshToken);
    const [cookieName, cookieValue] = (mockRes.cookie as jest.Mock).mock.calls[0];
    expect(cookieName).toBe('refresh_token');
    expect(decryptRefreshToken(cookieValue)).toBe('new-refresh-token');
    expect(result).toEqual({ access_token: 'new-access-token' });
  });

  it('should throw UnauthorizedException when refresh_token is missing', async () => {
    const mockReq = {
      cookies: {},
    } as Request;
    const mockRes: Partial<Response> = { cookie: jest.fn() };

    await expect(controller.refresh(mockReq, mockRes as Response)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should clear a refresh cookie it cannot decrypt, and never present it to the service', async () => {
    const mockReq = {
      cookies: { refresh_token: 'not-a-valid-cookie' },
    } as unknown as Request;
    const mockRes: Partial<Response> = { cookie: jest.fn(), clearCookie: jest.fn() };

    await expect(controller.refresh(mockReq, mockRes as Response)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ path: '/auth/refresh' }),
    );
    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(mockRes.cookie).not.toHaveBeenCalled();
  });

  it('should hand the caller a fresh refresh cookie after a password change', async () => {
    (authService.changePassword as jest.Mock).mockResolvedValue({
      access_token: 'unused',
      refresh_token: 'refresh-after-change',
    });

    const mockReq = { user: { id: 7 } } as unknown as RequestWithUser;
    const mockRes: Partial<Response> = { cookie: jest.fn() };
    const result = await controller.changePassword(
      { currentPassword: 'old-password', newPassword: 'new-password-1' },
      mockReq,
      mockRes as Response,
    );

    expect(authService.changePassword).toHaveBeenCalledWith(7, 'new-password-1', 'old-password');
    const [cookieName, cookieValue] = (mockRes.cookie as jest.Mock).mock.calls[0];
    expect(cookieName).toBe('refresh_token');
    expect(decryptRefreshToken(cookieValue)).toBe('refresh-after-change');
    expect(result).toEqual({ success: true });
  });

  it('should revoke every session for the user and clear the refresh cookie', async () => {
    const mockReq = { user: { id: 7 } } as unknown as RequestWithUser;
    const mockRes: Partial<Response> = {
      clearCookie: jest.fn(),
    };
    const result = await controller.logout(mockReq, mockRes as Response);

    expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith(7);
    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    expect(result).toEqual({ success: true });
  });

  it('should clear the cookie even though the request never carries it', async () => {
    const mockReq = { user: { id: 7 }, cookies: {} } as unknown as RequestWithUser;
    const mockRes: Partial<Response> = {
      clearCookie: jest.fn(),
    };
    const result = await controller.logout(mockReq, mockRes as Response);

    expect(result).toEqual({ success: true });
    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ path: '/auth/refresh' }),
    );
  });

  describe('over HTTP', () => {
    let app: INestApplication;

    beforeEach(async () => {
      app = module.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('should answer logout with the 200 its contract documents', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(HttpStatus.OK, { success: true });

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith(7);
    });
  });
});
