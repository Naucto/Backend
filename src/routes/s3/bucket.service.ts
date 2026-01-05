import { Inject, Injectable } from "@nestjs/common";
import { S3Client, ListBucketsCommand, DeleteBucketCommand, CreateBucketCommand, PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import { BucketPolicy } from "./s3.interface";
import { BucketResolutionException, S3ListBucketsException, S3DeleteBucketException, S3CreateBucketException, S3ApplyPolicyException } from "./s3.error";
import { Bucket } from "@aws-sdk/client-s3";
import { ListBucketsCommandInput, DeleteBucketCommandInput, CreateBucketCommandInput, PutBucketPolicyCommandInput } from "@aws-sdk/client-s3";
import { BucketPolicyStatement } from "./s3.interface";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class BucketService {
  private readonly defaultBucket: string | undefined;

  constructor(
    private readonly s3: S3Client,
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {
    this.defaultBucket = this.configService.get<string>("AWS_DEFAULT_BUCKET");
  }

  private resolveBucket(bucketName?: string): string {
    const resolved = bucketName || this.defaultBucket;
    if (!resolved) {
      throw new BucketResolutionException("No bucket name provided and no default bucket configured.");
    }
    return resolved;
  }

  async listBuckets(): Promise<Bucket[]> {
    try {
      const input: ListBucketsCommandInput = {};
      const command = new ListBucketsCommand(input);
      const result = await this.s3.send(command);
      return result.Buckets || [];
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new S3ListBucketsException(error.message, { cause: error });
      } else {
        throw new S3ListBucketsException("An unknown error occurred while listing buckets.");
      }
    }
  }

  async deleteBucket(bucketName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: DeleteBucketCommandInput = { Bucket: resolvedBucketName };
      const command = new DeleteBucketCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3DeleteBucketException(resolvedBucketName, error);
    }
  }

  async createBucket(bucketName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: CreateBucketCommandInput = {
        Bucket: resolvedBucketName
      };
      const command = new CreateBucketCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3CreateBucketException(resolvedBucketName, error);
    }
  }

  generateBucketPolicy(bucketName?: string, actions: string[] = ["s3:GetObject"], effect = "Allow", principal = "*", prefix = "*"): BucketPolicy {
    const resolvedBucketName = this.resolveBucket(bucketName);

    const statement: BucketPolicyStatement = {
      Sid: "BucketPolicy",
      Effect: effect,
      Principal: principal === "*" ? "*" : { AWS: principal },
      Action: actions,
      Resource:
        prefix === "*"
          ? `arn:aws:s3:::${resolvedBucketName}/*`
          : `arn:aws:s3:::${resolvedBucketName}/${prefix}`,
    };

    return {
      Version: "2012-10-17",
      Statement: [ statement ]
    };
  }

  async applyBucketPolicy(policy: BucketPolicy, bucketName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: PutBucketPolicyCommandInput = {
        Bucket: resolvedBucketName,
        Policy: typeof policy === "string" ? policy : JSON.stringify(policy)
      };

      const command = new PutBucketPolicyCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3ApplyPolicyException(resolvedBucketName, error);
    }
  }
}
