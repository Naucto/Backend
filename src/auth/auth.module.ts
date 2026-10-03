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
import { parseExpiresIn } from "./auth.utils";
import { GoogleAuthService } from "./providers/google-auth.service";
import { GithubAuthService } from "./providers/github-auth.service";
import { MicrosoftAuthService } from "./providers/microsoft-auth.service";
import { Module, Logger } from "@nestjs/common";

@Module({
  imports: [
    ConfigModule,
    UserModule,
    PassportModule.register({}),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => {
        const logger = new Logger("AuthModule");
        const env = cs.get<string>("NODE_ENV") ?? "development";
        const secret = cs.get<string>("JWT_SECRET");

        if (!secret) {
          throw new MissingEnvVarError("JWT_SECRET");
        }
        if (env === "development" && secret.length < 16) {
          logger.warn(
            `JWT_SECRET is quite short (${secret.length} chars). Consider using a longer, more secure secret.`
          );
        }

        const expiresIn = parseExpiresIn("JWT_EXPIRES_IN", cs.get<string>("JWT_EXPIRES_IN"), "1h");
        // Parsed for its refusal alone: an unreadable lifetime has to stop the boot, not a sign-in.
        parseExpiresIn("JWT_REFRESH_EXPIRES_IN", cs.get<string>("JWT_REFRESH_EXPIRES_IN"), "7d");

        if (env === "development") {
          logger.log("JWT config loaded successfully");
          logger.log(`→ JWT_SECRET length: ${secret.length}`);
          logger.log(`→ JWT_EXPIRES_IN: ${expiresIn}`);
        }

        return {
          secret,
          signOptions: {
            expiresIn: expiresIn
          }
        };
      }
    })
  ],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    AuthService,
    GoogleAuthService,
    GithubAuthService,
    MicrosoftAuthService,
    JwtStrategy
  ],
  // UserModule rides along with RolesGuard: the guard takes a UserService, and Nest builds it in
  // the *consumer's* injector — so exporting the guard without its dependency makes any module
  // that uses it fail to resolve at boot.
  exports: [JwtAuthGuard, RolesGuard, JwtModule, UserModule],
  controllers: [AuthController]
})
export class AuthModule {}
