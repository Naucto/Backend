import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { PrismaModule } from "@prisma/prisma.module";
import { AuthService } from "./auth.service";

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
  
  it("should call authService.login and return access_token", async () => {
    const loginDto = { email: "test@example.com", password: "password" };
    const expectedResult = { access_token: "token123" };
    
    (authService.login as jest.Mock).mockResolvedValue(expectedResult);

    const result = await controller.login(loginDto);

    expect(authService.login).toHaveBeenCalledWith(loginDto.email, loginDto.password);
    expect(result).toEqual(expectedResult);
  });
});
