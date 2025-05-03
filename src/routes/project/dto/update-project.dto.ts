import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsUrl, Min } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  // PartialType makes all properties from CreateProjectDto optional
  // This is perfect for update operations where only changed fields need to be sent
}