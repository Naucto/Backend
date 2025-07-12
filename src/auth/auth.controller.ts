import { Controller, Post, Body } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { ApiOperation, ApiResponse, ApiTags, ApiBody } from "@nestjs/swagger";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @ApiOperation({ summary: "Authenticate a user and return an access token" })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 201,
    description: "Login successful",
    type: AuthResponseDto
  })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto.email, loginDto.password);
  }

  @Post("register")
  @ApiOperation({ summary: "Register a new user and return an access token" })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: "User registered successfully",
    type: AuthResponseDto
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 409, description: "Email already in use" })
  @ApiResponse({ status: 403, description: "Cannot register as an admin" })
  async register(@Body() createUserDto: CreateUserDto): Promise<AuthResponseDto> {
    return this.authService.register(createUserDto);
  }
}
