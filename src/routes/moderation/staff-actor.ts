import { parseRole, RoleName } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';

/** The staff member a moderation route acts for. */
export interface StaffActor {
  id: string;
  role: RoleName;
}

export function staffOf(req: RequestWithUser): StaffActor {
  return { id: req.user.id, role: parseRole(req.user.role) };
}
