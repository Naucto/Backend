import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isObservable, lastValueFrom } from 'rxjs';

import { UserService } from '../../routes/user/user.service';
import { Access, ACCESS_KEY } from './access.decorators';
import { ADMIN, holdsRole } from './roles';

/** What a route that states nothing gets: forgetting to annotate one must not open it. */
const DEFAULT_ACCESS: Access = { kind: 'role', role: ADMIN };

/**
 * The application's only authentication guard, registered globally: every route is decided by the
 * access its handler or, failing that, its controller declares.
 */
@Injectable()
export class AccessGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
  ) {
    super();
  }

  /** Runs the JWT strategy, which attaches the account to the request or throws a 401. */
  private async authenticate(context: ExecutionContext): Promise<void> {
    const activated = super.canActivate(context);
    await (isObservable(activated) ? lastValueFrom(activated) : activated);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const access =
      this.reflector.getAllAndOverride<Access | undefined>(ACCESS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_ACCESS;
    const request = context.switchToHttp().getRequest<{ user?: { id: number } | null }>();

    if (access.kind === 'public') {
      try {
        await this.authenticate(context);
      } catch {
        request.user = null;
      }
      return true;
    }

    await this.authenticate(context);

    if (access.kind === 'auth') {
      return true;
    }

    const userId = request.user?.id;
    if (userId === undefined) {
      return false;
    }
    return holdsRole(await this.userService.getUserRole(userId), access.role);
  }
}
