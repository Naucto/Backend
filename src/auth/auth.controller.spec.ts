import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AuthService } from "./auth.service";

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
        }
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
    const expectedResult = { access_token: "token123" };

    (authService.login as jest.Mock).mockResolvedValue(expectedResult);

    const mockRes = { cookie: jest.fn() } as any;
    const result = await controller.login(loginDto, mockRes);

    expect(authService.login).toHaveBeenCalledWith(
      loginDto.email,
      loginDto.password
    );
    expect(result).toEqual(expectedResult);
  });
});
