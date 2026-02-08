import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { PrismaModule } from "@prisma/prisma.module";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { Response } from "express";

describe("AuthController", () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            register: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("login", () => {
    it("should call authService.login with correct credentials", async () => {
      const loginDto: LoginDto = { email: "test@example.com", password: "password" };
      const expectedResult = { access_token: "token123", refresh_token: "refresh123" };
      
      (authService.login as jest.Mock).mockResolvedValue(expectedResult);

      const mockResponse = {
        cookie: jest.fn(),
      } as unknown as Response;

      const result = await controller.login(loginDto, mockResponse);

      expect(authService.login).toHaveBeenCalledWith(loginDto.email, loginDto.password);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        "refresh_token",
        "refresh123",
        expect.objectContaining({
          httpOnly: true,
          secure: expect.any(Boolean),
          sameSite: "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        })
      );
      expect(result).toEqual({ access_token: "token123" });
    });

    it("should handle login errors", async () => {
      const loginDto: LoginDto = { email: "test@example.com", password: "wrong" };
      
      (authService.login as jest.Mock).mockRejectedValue(new Error("Invalid credentials"));

      const mockResponse = {
        cookie: jest.fn(),
      } as unknown as Response;

      await expect(controller.login(loginDto, mockResponse)).rejects.toThrow("Invalid credentials");
    });
  });

  describe("register", () => {
    it("should call authService.register and set refresh cookie", async () => {
      const createUserDto: CreateUserDto = {
        email: "new@example.com",
        username: "newuser",
        password: "password",
        roles: [],
      };
      const expectedResult = { access_token: "token123", refresh_token: "refresh123" };
      
      (authService.register as jest.Mock).mockResolvedValue(expectedResult);

      const mockResponse = {
        cookie: jest.fn(),
      } as unknown as Response;

      const result = await controller.register(createUserDto, mockResponse);

      expect(authService.register).toHaveBeenCalledWith(createUserDto);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        "refresh_token",
        "refresh123",
        expect.objectContaining({
          httpOnly: true,
          secure: expect.any(Boolean),
        })
      );
      expect(result).toEqual({ access_token: "token123" });
    });

    it("should handle registration errors", async () => {
      const createUserDto: CreateUserDto = {
        email: "exists@example.com",
        username: "user",
        password: "password",
        roles: [],
      };
      
      (authService.register as jest.Mock).mockRejectedValue(new Error("Email already exists"));

      const mockResponse = {
        cookie: jest.fn(),
      } as unknown as Response;

      await expect(controller.register(createUserDto, mockResponse)).rejects.toThrow("Email already exists");
    });
  });
});
