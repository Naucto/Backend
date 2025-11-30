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
import { MissingEnvVarError, BadEnvVarError } from "./auth.error";

type DurationString = `${number}${"s"|"m"|"h"|"d"}`;

function parseExpiresIn(v?: string): number | DurationString {
  if (!v) return "1h";
  if (/^\d+$/.test(v)) return Number(v);
  if (/^\d+[smhd]$/.test(v)) return v as DurationString;
  throw new BadEnvVarError(`Invalid JWT_EXPIRES_IN: ${v}`);
}

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

        const expiresIn = parseExpiresIn(cs.get<string>("JWT_EXPIRES_IN"));

        return {
          secret,
          signOptions: {
            expiresIn: expiresIn
	  }
        };
      },
    }),
  ],
  providers: [JwtAuthGuard, JwtStrategy, RolesGuard, AuthService],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
  controllers: [AuthController],
})
export class AuthModule {}
