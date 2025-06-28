import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../routes/user/user.service';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto } from '../routes/user/dto/create-user.dto';
import { UserDto } from './dto/user.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<UserDto> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
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
      throw new ConflictException('Email already in use');
    }

    if (existingByUsername.length > 0) {
      throw new ConflictException('Username already in use');
    }

    if (createUserDto.roles && createUserDto.roles.includes(1)) {
        throw new ForbiddenException('You cannot register as an admin');
    }

    if (!createUserDto.roles || createUserDto.roles.length === 0) {
        const defaultRole = await this.userService.findRolesByNames(['User']);
        createUserDto.roles = defaultRole.map((role: { id: any; }) => role.id);
    }

    const newUser = await this.userService.create(createUserDto);

    const payload = { sub: newUser.id, email: newUser.email };
    const accessToken = this.jwtService.sign(payload);

    const response: AuthResponseDto = {
      access_token: accessToken,
    };

    return response;
  }
}
