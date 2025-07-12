import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString } from "class-validator";

export class GeneratePolicyDto {
  @ApiProperty({
    description: "S3 actions to include in the policy",
    type: [String],
    example: ["s3:GetObject", "s3:PutObject"],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly actions?: string[];

  @ApiProperty({
    description: "Policy effect (Allow or Deny)",
    example: "Allow",
    required: false,
  })
  @IsOptional()
  @IsString()
  readonly effect?: string;

  @ApiProperty({
    description: "AWS principal",
    example: "*",
    required: false,
  })
  @IsOptional()
  @IsString()
  readonly principal?: string;

  @ApiProperty({
    description: "Object key prefix",
    example: "public/",
    required: false,
  })
  @IsOptional()
  @IsString()
  readonly prefix?: string;
}
