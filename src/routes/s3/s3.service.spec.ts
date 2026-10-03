import {
  ListObjectsV2Command,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

import { withEnv } from '../../../test/env';
import {
  BucketResolutionException,
  S3ConfigurationException,
  S3DeleteFilesException,
  S3DownloadException,
  S3ListObjectsException,
  S3ObjectNotFoundException,
  S3UploadException,
} from './s3.error';
import { S3Service } from './s3.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  ListObjectsV2Command: jest.fn(),
  HeadObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectsCommand: jest.fn(),
  PutObjectAclCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/lib-storage', () => ({ Upload: jest.fn() }));

describe('S3Service', () => {
  let s3Service: S3Service;
  let mockS3: S3Client & { send: jest.Mock };

  beforeEach(() => {
    withEnv({
      S3_BUCKET_NAME: 'my-default-bucket',
      S3_REGION: 'fr-par',
      S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
    });
    mockS3 = { send: jest.fn() } as unknown as S3Client & { send: jest.Mock };
    s3Service = new S3Service();
    (s3Service as any).s3 = mockS3;
  });

  it('names every missing storage variable at once', () => {
    withEnv({ S3_REGION: undefined, S3_SECRET_ACCESS_KEY: undefined });
    expect(() => new S3Service()).toThrow(S3ConfigurationException);
    expect(() => new S3Service()).toThrow('S3_REGION, S3_SECRET_ACCESS_KEY');
  });

  describe('resolveBucket', () => {
    it('returns default bucket', () => {
      expect(s3Service['resolveBucket']()).toBe('my-default-bucket');
    });

    it('throws when no bucket', () => {
      withEnv({ S3_BUCKET_NAME: undefined });
      const service = new S3Service();
      (service as any).s3 = mockS3;
      expect(() => service['resolveBucket']()).toThrow(BucketResolutionException);
    });
  });

  describe('listObjects', () => {
    it('returns objects', async () => {
      mockS3.send.mockResolvedValueOnce({ Contents: [{ Key: 'file.txt' }] });
      const result = await s3Service.listObjects();
      expect(result).toEqual([{ Key: 'file.txt' }]);
      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'my-default-bucket',
      });
    });

    it('returns empty array when no contents', async () => {
      mockS3.send.mockResolvedValueOnce({});
      const result = await s3Service.listObjects();
      expect(result).toEqual([]);
    });

    it('throws S3ListObjectsException on error', async () => {
      const err = new Error('Access Denied');
      mockS3.send.mockRejectedValueOnce(err);
      await expect(s3Service.listObjects()).rejects.toThrow(S3ListObjectsException);
    });
  });

  describe('getFileMetadataOrNull', () => {
    it('returns the metadata of an existing object', async () => {
      mockS3.send.mockResolvedValueOnce({ ETag: '"abc"' });

      await expect(s3Service.getFileMetadataOrNull('users/1/profile')).resolves.toEqual({
        ETag: '"abc"',
      });
    });

    it.each([
      Object.assign(new Error('missing'), { name: 'NotFound' }),
      Object.assign(new Error('missing'), {
        name: 'UnknownError',
        $metadata: { httpStatusCode: 404 },
      }),
    ])('returns null when the store has no such object (%s)', async (error) => {
      mockS3.send.mockRejectedValueOnce(error);

      await expect(s3Service.getFileMetadataOrNull('users/1/profile')).resolves.toBeNull();
    });

    it('does not report a store failure as a missing object', async () => {
      const denied = Object.assign(new Error('denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      mockS3.send.mockRejectedValueOnce(denied);

      await expect(s3Service.getFileMetadataOrNull('users/1/profile')).rejects.toBe(denied);
    });
  });

  describe('downloadFile', () => {
    it('returns an empty object', async () => {
      mockS3.send
        .mockResolvedValueOnce({
          ContentType: 'application/octet-stream',
          ContentLength: 0,
        })
        .mockResolvedValueOnce({ Body: 'stream' });

      await expect(s3Service.downloadFile({ key: 'save/1/empty' })).resolves.toEqual({
        body: 'stream',
        contentType: 'application/octet-stream',
        contentLength: 0,
      });
    });

    it.each(['NotFound', 'NoSuchKey'])(
      'reports a missing object as not found (%s)',
      async (name) => {
        mockS3.send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name }));

        await expect(s3Service.downloadFile({ key: 'release/1' })).rejects.toBeInstanceOf(
          S3ObjectNotFoundException,
        );
      },
    );

    it('does not report a store failure as a missing object', async () => {
      mockS3.send.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED'), { name: 'Error' }),
      );

      const failure: unknown = await s3Service
        .downloadFile({ key: 'release/1' })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(S3DownloadException);
      expect(failure).not.toBeInstanceOf(S3ObjectNotFoundException);
    });
  });

  describe('uploadFile', () => {
    const multerFile = {
      originalname: 'cover.png',
      mimetype: 'image/png',
      buffer: Buffer.from('png'),
    } as Express.Multer.File;

    it('puts a buffered file under the given key', async () => {
      mockS3.send.mockResolvedValueOnce({});

      await s3Service.uploadFile({
        file: multerFile,
        keyName: 'projects/1/image',
        metadata: { owner: '1' },
        cacheControl: 'no-cache',
      });

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-default-bucket',
        Key: 'projects/1/image',
        Body: multerFile.buffer,
        ContentType: 'image/png',
        Metadata: { owner: '1' },
        CacheControl: 'no-cache',
      });
      expect(mockS3.send).toHaveBeenCalledTimes(1);
    });

    it('names the key in the failure of a buffered upload', async () => {
      mockS3.send.mockRejectedValueOnce(new Error('Access Denied'));

      const failure: unknown = await s3Service
        .uploadFile({ file: multerFile, keyName: 'projects/1/image' })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(S3UploadException);
      expect((failure as S3UploadException).fileName).toBe('projects/1/image');
    });

    it('streams a downloaded file under the given key', async () => {
      const done = jest.fn().mockResolvedValue({});
      (Upload as unknown as jest.Mock).mockImplementation(() => ({ done }));
      const body = Readable.from(['content']);

      await s3Service.uploadFile({
        file: { body, contentType: 'application/zip' },
        keyName: 'release/2',
      });

      expect(Upload).toHaveBeenCalledWith({
        client: mockS3,
        params: {
          Bucket: 'my-default-bucket',
          Key: 'release/2',
          Body: body,
          ContentType: 'application/zip',
        },
      });
      expect(done).toHaveBeenCalledTimes(1);
      expect(mockS3.send).not.toHaveBeenCalled();
    });

    it('names the key in the failure of a streamed upload', async () => {
      (Upload as unknown as jest.Mock).mockImplementation(() => ({
        done: jest.fn().mockRejectedValue(new Error('connection reset')),
      }));

      const failure: unknown = await s3Service
        .uploadFile({
          file: { body: Readable.from(['content']) },
          keyName: 'release/2',
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(S3UploadException);
      expect((failure as S3UploadException).fileName).toBe('release/2');
    });
  });

  describe('deleteFiles', () => {
    it('returns the deleted objects', async () => {
      mockS3.send.mockResolvedValueOnce({ Deleted: [{ Key: 'a' }] });

      await expect(s3Service.deleteFiles({ keys: ['a'] })).resolves.toEqual([{ Key: 'a' }]);
    });

    it('fails when the store refuses some of the keys', async () => {
      mockS3.send.mockResolvedValueOnce({
        Deleted: [{ Key: 'a' }],
        Errors: [{ Key: 'b', Code: 'AccessDenied' }],
      });

      const failure: unknown = await s3Service
        .deleteFiles({ keys: ['a', 'b'] })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(S3DeleteFilesException);
      expect((failure as S3DeleteFilesException).keys).toEqual(['b']);
    });
  });

  describe('setObjectPublicRead', () => {
    it('marks the object public', async () => {
      mockS3.send.mockResolvedValueOnce({});
      await s3Service.setObjectPublicRead('release/1');
      expect(mockS3.send).toHaveBeenCalledTimes(1);
      expect(PutObjectAclCommand).toHaveBeenCalledWith({
        Bucket: 'my-default-bucket',
        Key: 'release/1',
        ACL: 'public-read',
      });
    });

    it('tolerates a store without per-object ACLs', async () => {
      mockS3.send.mockRejectedValueOnce(
        Object.assign(new Error('Not Implemented'), { name: 'NotImplemented' }),
      );
      await expect(s3Service.setObjectPublicRead('release/1')).resolves.toBeUndefined();
    });

    it('still surfaces a real failure', async () => {
      mockS3.send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'AccessDenied' }));
      await expect(s3Service.setObjectPublicRead('release/1')).rejects.toThrow('nope');
    });
  });
});
