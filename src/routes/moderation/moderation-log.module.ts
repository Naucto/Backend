import { Module } from '@nestjs/common';

import { ModerationLogService } from './moderation-log.service';

/**
 * The log alone, apart from the moderation feature: any module whose own writes belong in the log
 * imports this one without taking on the feature and what it depends on.
 */
@Module({
  providers: [ModerationLogService],
  exports: [ModerationLogService],
})
export class ModerationLogModule {}
