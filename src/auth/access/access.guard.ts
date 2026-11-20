import { ExecutionContext, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isObservable, lastValueFrom } from 'rxjs';

import { CodedException } from '../../common/coded.exception';
import { UserService } from '../../routes/user/user.service';
import { TokenInfo } from '../auth.types';
import { Access, ACCESS_KEY, STAFF_SESSION_REQUIRED } from './access.decorators';
import { ADMIN, holdsRole } from './roles';

/** What a route that states nothing gets: forgetting to annotate one must not open it. */
const DEFAULT_ACCESS: Access = { kind: 'role', role: ADMIN };

interface AccessRequest {
  user?: { id: number } | null;
  /** Set by passport from the strategy once the token verified. */
  authInfo?: TokenInfo;
}

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
    const request = context.switchToHttp().getRequest<AccessRequest>();

    if (access.kind === 'public') {
      try {
        await this.authenticate(context);
      } catch {
        request.user = null;
      }
      if (request.authInfo?.staff === true) {
        request.user = null;
      }
      return true;
    }

    await this.authenticate(context);
    const staffToken = request.authInfo?.staff === true;

    // A 401 rather than a 403: the admin console renews its token on a 401, which is what turns a
    // token issued before the staff scope existed into one that carries it.
    if (access.kind === 'staff' && !staffToken) {
      throw new CodedException(
        HttpStatus.UNAUTHORIZED,
        STAFF_SESSION_REQUIRED,
        'Staff session required',
      );
    }
    // The two kinds of token never stand in for each other: one taken from the admin console
    // cannot act as its account on the site.
    if (access.kind !== 'staff' && staffToken) {
      throw new UnauthorizedException('A staff session opens the admin console only');
    }

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
