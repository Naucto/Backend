import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { UserModule } from "@user/user.module";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MissingEnvVarError } from "./auth.error";
import { GoogleAuthService } from "./google-auth.service";

@Module({
  imports: [
    ConfigModule,
    UserModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => {
        const secret = cs.get<string>("JWT_SECRET");
        if (!secret) {
          throw new MissingEnvVarError("JWT_SECRET");
        }
        const expiresIn = (cs.get<string>("JWT_EXPIRES_IN") ?? "1h") as `${number}${"s" | "m" | "h" | "d"}`;

        return {
          secret,
          signOptions: { expiresIn: expiresIn },
        };
      },
    }),
  ],
  providers: [JwtAuthGuard, JwtStrategy, RolesGuard, AuthService, GoogleAuthService],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
  controllers: [AuthController],
})
export class AuthModule {}
