import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserService } from '../../routes/user/user.service'; // Assure-toi d'importer le service qui gère l'utilisateur

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private userService: UserService, // Assure-toi d'injecter le UserService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user || !user.id) {
      return false;
    }

    // Récupère les rôles de l'utilisateur via son ID
    const userRoles = await this.userService.getUserRoles(user.id);

    return requiredRoles.some(role => userRoles.includes(role));
  }
}
