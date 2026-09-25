import { SetMetadata } from "@nestjs/common";
import { Permission } from "@auth/permissions";

export const PERMISSIONS_KEY = "permissions";
export const Permissions = (...permissions: Permission[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(PERMISSIONS_KEY, permissions);
