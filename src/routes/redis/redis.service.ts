import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getFile(key: string): Promise<Buffer | null> {
    const result = await this.redis.getBuffer(key);
    return result ?? null;
  }

  async setFile(key: string, buffer: Buffer, ttlSeconds = 3600): Promise<void> {
    await this.redis.set(key, buffer, 'EX', ttlSeconds);
  }

  async deleteFile(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
