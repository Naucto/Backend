import { ApiProperty } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { CreateWorkSessionDto } from './create-work-session.dto';

export class UpdateWorkSessionDto extends PartialType(CreateWorkSessionDto) {
  // PartialType makes all properties from CreateWorkSessionDto optional
  // This is perfect for update operations where only changed fields need to be sent
}
