import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class ApplyPolicyDto {
  @ApiProperty({
    description: 'S3 bucket policy to apply',
    example: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: 'arn:aws:s3:::my-bucket/*',
        },
      ],
    },
  })
  @IsNotEmpty()
  readonly policy: any;
}