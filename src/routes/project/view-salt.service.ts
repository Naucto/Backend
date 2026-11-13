import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { utcDay } from '../analytics/analytics-time';

/**
 * The salt network addresses are hashed with, drawn anew for each UTC day and never written
 * anywhere: once a day is over, nothing can tie its codes to an address or to another day's. Held
 * in memory, which holds while the backend runs as one instance; a restart draws a new salt, so an
 * address seen before it counts once more that day.
 */
@Injectable()
export class ViewSaltService {
  private day = '';
  private salt = Buffer.alloc(0);

  saltOf(now: Date): Buffer {
    const day = utcDay(now);
    if (day !== this.day) {
      this.day = day;
      this.salt = randomBytes(32);
    }
    return this.salt;
  }
}
