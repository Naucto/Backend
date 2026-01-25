import { ApiProperty } from "@nestjs/swagger";
import { IsNumber } from "class-validator";

export class AddCollaboratorDto {
  @ApiProperty({
    description: "The User to add to the project as collaborator",
    example: "1234"
  })
  @IsNumber()
  userId!: number;
}

export class RemoveCollaboratorDto {
  @ApiProperty({
    description: "The User to add to the project as collaborator",
    example: "1234"
  })
  @IsNumber()
  userId!: number;
}
