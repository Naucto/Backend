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
import { Module, Logger } from "@nestjs/common";
import { isStringValue } from "./auth.utils";


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
                const expiresIn = cs.get<string>("JWT_EXPIRES_IN") ?? "1h";

                if (!secret) {
                    throw new MissingEnvVarError("JWT_SECRET");
                }
                if (secret === "undefined" || secret === "null") {
                    throw new MissingEnvVarError("JWT_SECRET seems malformed (string 'undefined' or 'null')");
                }
                if (expiresIn === "undefined" || expiresIn === "null") {
                    logger.warn(`JWT_EXPIRES_IN seems malformed ("${expiresIn}"). Falling back to default "1h".`);
                }
                if (env === "development" && secret.length < 16) {
                    logger.warn(`JWT_SECRET is quite short (${secret.length} chars). Consider using a longer, more secure secret.`);
                }

                if (!isStringValue(expiresIn) && isNaN(Number(expiresIn))) {
                    logger.error(`Invalid JWT_EXPIRES_IN value: "${expiresIn}". Expected a number or a string like "60s", "2h", or "1d".`);
                    throw new Error(`Invalid JWT_EXPIRES_IN value: ${expiresIn}`);
                }

                if (env === "development") {
                    logger.log(`JWT config loaded successfully ✅`);
                    logger.log(`→ JWT_SECRET length: ${secret.length}`);
                    logger.log(`→ JWT_EXPIRES_IN: ${expiresIn}`);
                }

                return {
                    secret,
                    signOptions: {
                        expiresIn: isStringValue(expiresIn) ? expiresIn : Number(expiresIn),
                    },
                };
            },
        }),
    ],
    providers: [JwtAuthGuard, JwtStrategy, RolesGuard, AuthService, GoogleAuthService],
    exports: [JwtAuthGuard, RolesGuard, JwtModule],
    controllers: [AuthController],
})
export class AuthModule {}
