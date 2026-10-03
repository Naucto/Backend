import { Injectable, Logger } from '@nestjs/common';

import { EdgeService, versionedUrl } from '../s3/edge.service';
import { S3Service } from '../s3/s3.service';

export type ProfileAsset = 'profile' | 'background';

export const PROFILE_ASSETS: readonly ProfileAsset[] = ['profile', 'background'];

export interface ProfileImageUrls {
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
}

function profileAssetKey(userId: number, asset: ProfileAsset): string {
  return `users/${userId}/${asset}`;
}

/** The two images a person may set on their profile, stored publicly readable under one key each. */
@Injectable()
export class ProfileAssetService {
  private readonly logger = new Logger(ProfileAssetService.name);

  constructor(
    private readonly s3Service: S3Service,
    private readonly edgeService: EdgeService,
  ) {}

  /** The image's public address, versioned by its content; null when none is set. */
  async url(userId: number, asset: ProfileAsset): Promise<string | null> {
    const key = profileAssetKey(userId, asset);
    const head = await this.s3Service.getFileMetadataOrNull(key);
    if (!head) {
      return null;
    }

    return versionedUrl(this.edgeService.getCDNUrl(key), head.ETag);
  }

  /**
   * Both images, for a profile answer. The pictures are decoration there: a store that cannot be
   * read costs them, not the answer.
   */
  async imageUrls(userId: number): Promise<ProfileImageUrls> {
    const urlOrNull = (asset: ProfileAsset): Promise<string | null> =>
      this.url(userId, asset).catch((error: unknown) => {
        this.logger.warn(
          `Profile image lookup failed for ${profileAssetKey(userId, asset)}: ${String(error)}`,
        );
        return null;
      });

    const [profileImageUrl, backgroundImageUrl] = await Promise.all([
      urlOrNull('profile'),
      urlOrNull('background'),
    ]);

    return { profileImageUrl, backgroundImageUrl };
  }

  /** Replaces the image and answers with its public address. */
  async store(userId: number, asset: ProfileAsset, file: Express.Multer.File): Promise<string> {
    const key = profileAssetKey(userId, asset);

    await this.s3Service.uploadFile({
      file,
      keyName: key,
      metadata: {
        uploadedBy: userId.toString(),
        userId: userId.toString(),
        originalName: file.originalname,
      },
      cacheControl: 'no-cache',
    });
    await this.s3Service.setObjectPublicRead(key);

    // The unversioned address is still correct when the store cannot be read back yet; the
    // version only busts the browser cache.
    return (await this.url(userId, asset)) ?? this.edgeService.getCDNUrl(key);
  }

  /** Idempotent: removing an image that is not there succeeds. */
  async remove(userId: number, asset: ProfileAsset): Promise<void> {
    await this.s3Service.deleteFile({ key: profileAssetKey(userId, asset) });
  }
}
