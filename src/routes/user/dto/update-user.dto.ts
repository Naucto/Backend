import { PartialType } from '@nestjs/swagger';
import { CreateUserRoleDto } from './create-user-role.dto';

export class UpdateUserDto extends PartialType(CreateUserRoleDto) {}
