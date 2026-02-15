import { ApiProperty } from "@nestjs/swagger";

export class SignedCdnResourceDto {
  @ApiProperty({
    example: "https://cdn.example.com/projects/42/image",
    description: "The CDN URL for the resource (requires signed cookies)"
  })
  resourceUrl!: string;

  @ApiProperty({
    description: "Signed CloudFront cookies (also set as HTTP-only cookies)",
    example: {
      "CloudFront-Expires": "1735660800",
      "CloudFront-Signature": "base64-signature",
      "CloudFront-Key-Pair-Id": "K1234567890",
      "CloudFront-Policy": "base64-policy"
    }
  })
  cookies!: Record<string, string>;
}
