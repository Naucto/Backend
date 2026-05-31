import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NestMiddleware
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE = "naucto_admin_csrf";
const CSRF_HEADER = "x-csrf-token";

const CSRF_BYPASS_PATHS = new Set<string>([
  "/admin/auth/login",
  "/admin/auth/refresh"
]);

@Injectable()
export class AdminCsrfMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AdminCsrfMiddleware.name);
  private readonly allowedOrigins: Set<string>;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const adminUrl = configService.get<string>(
      "ADMIN_PANEL_URL",
      "http://localhost:3002"
    );
    this.allowedOrigins = new Set([adminUrl].filter(Boolean));
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    const method = (req.method ?? "").toUpperCase();
    if (SAFE_METHODS.has(method)) {
      next();
      return;
    }

    const path = req.path ?? req.originalUrl ?? "";
    const isBypass = Array.from(CSRF_BYPASS_PATHS).some((bypass) =>
      path.endsWith(bypass)
    );

    const origin = req.headers["origin"];
    if (origin && !this.allowedOrigins.has(String(origin))) {
      this.logger.warn(`Rejected admin write from origin ${String(origin)}`);
      throw new ForbiddenException("Origin not allowed for admin endpoints");
    }

    if (isBypass) {
      next();
      return;
    }

    const cookieToken = (
      req as Request & { cookies?: Record<string, string> }
    ).cookies?.[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];

    if (
      !cookieToken ||
      !headerToken ||
      cookieToken !== headerToken
    ) {
      throw new ForbiddenException("CSRF token mismatch");
    }

    next();
  }
}
