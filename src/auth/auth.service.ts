import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../routes/user/user.service';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto } from '../routes/user/dto/create-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
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

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);

    const payload = { sub: user.id, email: user.email };
    const access_token = this.jwtService.sign(payload);

    const { password: _, ...userWithoutPassword } = user;

    return {
      access_token,
      user: userWithoutPassword,
    };
  }

  async register(createUserDto: CreateUserDto) {
    const existing = await this.userService.findAll({
      where: { email: createUserDto.email },
    });

    if (existing.length > 0) {
      throw new ConflictException('Email already in use');
    }

    const newUser = await this.userService.create(createUserDto);

    const payload = { sub: newUser.id, email: newUser.email };
    const accessToken = this.jwtService.sign(payload);

    return {
      access_token: accessToken,
      user: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
      },
    };
  }
}
