import { Injectable } from '@nestjs/common';

import { PageRequest } from '../../common/dto/pagination-query.dto';
import { StandingDto } from './dto/standing.dto';
import { notAvailableYet } from './moderation.error';

/** What an account reads of the moderation actions that bore on it. */
@Injectable()
export class StandingService {
  standing(_userId: number, _page: PageRequest): Promise<StandingDto> {
    return notAvailableYet();
  }
}
