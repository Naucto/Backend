import { Injectable } from '@nestjs/common';

import { CreatedFlagDto, CreateFlagDto } from './dto/flag.dto';
import { notAvailableYet } from './moderation.error';

/** What people report to staff. */
@Injectable()
export class FlagsService {
  create(_reporterId: number, _input: CreateFlagDto): Promise<CreatedFlagDto> {
    return notAvailableYet();
  }
}
