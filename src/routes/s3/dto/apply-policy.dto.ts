import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class BucketPolicyStatementDto {
  @ApiProperty()
  Sid!: string;

  @ApiProperty()
  Effect!: string;

  @ApiProperty()
  Principal!: "*" | { AWS: string };

  @ApiProperty({ type: [String] })
  Action!: string[];

  @ApiProperty()
  Resource!: string;
}

class BucketPolicyDto {
  @ApiProperty()
  Version!: string;

  @ApiProperty({ type: [BucketPolicyStatementDto] })
  @ValidateNested({ each: true })
  @Type(() => BucketPolicyStatementDto)
  Statement!: BucketPolicyStatementDto[];
}

export class ApplyPolicyDto {
  @ApiProperty({
    description: "S3 bucket policy to apply",
    example: {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "Stmt1",
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: "arn:aws:s3:::my-bucket/*"
        }
      ]
    }
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => BucketPolicyDto)
  readonly policy!: BucketPolicyDto;
}
