import { ApiProperty } from "@nestjs/swagger";
import { UserDto } from "@auth/dto/user.dto";
import { RoleDto } from "@auth/dto/role.dto";

export class UserWithDetailsDto extends UserDto {
  @ApiProperty({ type: [RoleDto] })
  override roles!: RoleDto[];

  @ApiProperty()
  projectsCreatedCount!: number;

  @ApiProperty()
  commentsCount!: number;

  @ApiProperty()
  reportsFiledCount!: number;

  @ApiProperty()
  moderationActionsTakenCount!: number;
}
