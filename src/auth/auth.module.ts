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
import { GoogleAuthService } from "./google-auth.service";
import { Module, Logger } from "@nestjs/common";

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
        const logger = new Logger("AuthModule");
        const env = cs.get<string>("NODE_ENV") ?? "development";
        const secret = cs.get<string>("JWT_SECRET");
        const expiresInRaw = cs.get<string>("JWT_EXPIRES_IN");

        if (!secret) {
          throw new MissingEnvVarError("JWT_SECRET");
        }
        if (env === "development" && secret.length < 16) {
          logger.warn(`JWT_SECRET is quite short (${secret.length} chars). Consider using a longer, more secure secret.`);
        }

        const expiresIn = parseExpiresIn(expiresInRaw);

        if (env === "development") {
          logger.log("JWT config loaded successfully");
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
  providers: [
    JwtAuthGuard,
    RolesGuard,
    AuthService,
    GoogleAuthService,
    JwtStrategy,
  ],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
  controllers: [AuthController],
})
export class AuthModule {}
