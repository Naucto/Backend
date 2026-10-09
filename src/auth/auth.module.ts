import { Logger, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { getEnv, getOptionalEnv } from '../config/env';
import { UserModule } from '../routes/user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { authLifetimes } from './auth.utils';
import { GithubAuthService } from './providers/github-auth.service';
import { GoogleAuthService } from './providers/google-auth.service';
import { MicrosoftAuthService } from './providers/microsoft-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UserModule,
    PassportModule.register({}),
    JwtModule.registerAsync({
      useFactory: () => {
        const logger = new Logger('AuthModule');
        const env = getOptionalEnv('NODE_ENV') ?? 'development';
        const secret = getEnv('JWT_SECRET');

        if (env === 'development' && secret.length < 16) {
          logger.warn(
            `JWT_SECRET is quite short (${secret.length} chars). Consider using a longer, more secure secret.`,
          );
        }

        // Read here so an unreadable lifetime stops the boot rather than a sign-in.
        const { accessToken: expiresIn } = authLifetimes();

        if (env === 'development') {
          logger.log('JWT config loaded successfully');
          logger.log(`→ JWT_SECRET length: ${secret.length}`);
          logger.log(`→ JWT_EXPIRES_IN: ${expiresIn}`);
        }

        return {
          secret,
          signOptions: {
            expiresIn: expiresIn,
          },
        };
      },
    }),
  ],
  providers: [AuthService, GoogleAuthService, GithubAuthService, MicrosoftAuthService, JwtStrategy],
  exports: [JwtModule, AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
