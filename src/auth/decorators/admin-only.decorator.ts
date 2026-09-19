import { UseGuards, applyDecorators } from "@nestjs/common";
import { ApiBearerAuth, ApiForbiddenResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RolesGuard } from "@auth/guards/roles.guard";
import { Roles } from "./roles.decorator";

/** Name of the role seeded by the `featured_release` migration. */
export const ADMIN_ROLE = "Admin";

/**
 * Restricts a controller or handler to authenticated users holding the
 * `Admin` role (JWT + roles guard + Swagger annotations in one decorator).
 */
export const AdminOnly = (): ReturnType<typeof applyDecorators> =>
  applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    Roles(ADMIN_ROLE),
    ApiBearerAuth("JWT-auth"),
    ApiForbiddenResponse({ description: "Admin role required" })
  );
