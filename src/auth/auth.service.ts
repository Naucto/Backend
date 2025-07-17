import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "@user/user.service";
import * as bcrypt from "bcryptjs";
import { UserDto } from "./dto/user.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { JwtPayload } from "./auth.types";
import { CreateUserDto } from "@user/dto/create-user.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<UserDto> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return user;
  }

  async login(email: string, password: string): Promise<AuthResponseDto> {
    const user = await this.validateUser(email, password);

    const payload : JwtPayload = { sub: user.id, email: user.email };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token
    };
  }

  async register(createUserDto: CreateUserDto): Promise<AuthResponseDto> {
    const [existingByEmail, existingByUsername] = await Promise.all([
      this.userService.findAll({ where: { email: createUserDto.email } }),
      this.userService.findAll({ where: { username: createUserDto.username } }),
    ]);

    if (existingByEmail.length > 0) {
      throw new ConflictException("Email already in use");
    }

    if (existingByUsername.length > 0) {
      throw new ConflictException("Username already in use");
    }

    createUserDto.roles = [];

    const newUser = await this.userService.create(createUserDto);

    const payload = { sub: newUser.id, email: newUser.email };
    const accessToken = this.jwtService.sign(payload);

    const response: AuthResponseDto = {
      access_token: accessToken,
    };

    return response;
  }
}
