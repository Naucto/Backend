import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { ModerationLogModule } from '../moderation/moderation-log.module';
import { AdminAccountController } from './admin-account.controller';
import { AdminAccountService } from './admin-account.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminSessionService } from './admin-session.service';

@Module({
  imports: [AuthModule, ModerationLogModule],
  controllers: [AdminAuthController, AdminAccountController],
  providers: [AdminSessionService, AdminAccountService],
})
export class AdminModule {}
